/**
 * @file Sending a `message` follow-up whose draft's channel is `github`: a
 *   comment on the issue or pull request its `to` names, through the person's
 *   own `gh`, only after the maintainer confirmed, scrubbed with the feedback
 *   redactor first. Then it is done. Every other channel is the maintainer's to
 *   send; Ork only drafts it.
 */

import type { GhRunner } from "../feedback/discussions.ts";
import { redact } from "../feedback/redact.ts";
import type { FollowUpRows } from "../store/follow-ups.ts";
import { githubDraftRefusal } from "./change.ts";
import type { FollowUp } from "./types.ts";

export type FollowUpPosted =
  | { ok: true; url?: string; followUp: FollowUp }
  | { ok: false; error: string };

/** Posts `f`'s draft as a GitHub comment once `confirmed`, and marks it done. */
export const postFollowUpMessage = async (
  f: FollowUp,
  options: {
    rows: FollowUpRows;
    gh: GhRunner;
    /** The maintainer said yes to exactly this text. */
    confirmed: boolean;
    home: string;
    now?: () => string;
  },
): Promise<FollowUpPosted> => {
  const draft = f.draft;
  const refused = githubDraftRefusal(f);
  if (refused !== undefined || draft === undefined) {
    return { ok: false, error: refused?.error ?? "it has no draft" };
  }
  if (!options.confirmed) {
    return {
      ok: false,
      error: "posting to GitHub needs the maintainer's confirmation",
    };
  }
  const body = redact(draft.text, { roots: [f.project], home: options.home });
  const on = /\/pull\/\d+/u.test(draft.to) ? "pr" : "issue";
  const result = await options.gh([on, "comment", draft.to, "--body", body], {
    cwd: f.project,
  });
  if (!result.ok) {
    const why = result.stderr.trim() || result.stdout.trim() || "no output";
    return { ok: false, error: `gh failed: ${why}` };
  }
  const url = result.stdout
    .trim()
    .split("\n")
    .findLast(line => line.startsWith("https://"));
  const done: FollowUp = {
    ...f,
    status: "done",
    note: `posted${url === undefined ? "" : ` as ${url}`}`,
    updatedAt: options.now?.() ?? new Date().toISOString(),
  };
  options.rows.putFollowUp(done);
  return { ok: true, followUp: done, ...(url === undefined ? {} : { url }) };
};
