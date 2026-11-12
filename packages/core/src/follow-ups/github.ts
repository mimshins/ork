/**
 * @file The `github` follow-up store: each new follow-up becomes an issue in
 *   the project's repository through the person's own `gh`, labelled
 *   `ork-follow-up` (or the rule's label), and its URL is kept. When `gh` isn't
 *   signed in, or can't create the issue, the follow-up stays in Ork's store
 *   and the result says so. Ork reads no token.
 */

import { DEFAULT_FOLLOW_UPS_LABEL } from "@krapht/ork-schema";

import { followUpMarkdown } from "./markdown.ts";
import type { FollowUpPlaceAdapter } from "./types.ts";

const why = (result: { stdout: string; stderr: string }): string =>
  result.stderr.trim() || result.stdout.trim() || "no output";

export const githubFollowUps: FollowUpPlaceAdapter = {
  place: "github",
  keep: async (f, context) => {
    const cwd = context.project;
    const auth = await context.gh(["auth", "status"], { cwd });
    if (!auth.ok) {
      return {
        place: "store",
        note: "gh isn't signed in, so the follow-up is kept in Ork's store instead; run `gh auth login` for GitHub issues.",
      };
    }
    const label = context.rule.label ?? DEFAULT_FOLLOW_UPS_LABEL;
    // Makes sure the label exists; if this fails, creating the issue says why.
    await context.gh(
      [
        "label",
        "create",
        label,
        "--force",
        "--color",
        "5319e7",
        "--description",
        "Work an Ork change left for later",
      ],
      { cwd },
    );
    const body = `${followUpMarkdown(f)}\n\n<sub>Added by Ork.</sub>`;
    const created = await context.gh(
      ["issue", "create", "--title", f.title, "--body", body, "--label", label],
      { cwd },
    );
    if (!created.ok) {
      return {
        place: "store",
        note: `gh couldn't create the issue (${why(created)}), so the follow-up is kept in Ork's store instead.`,
      };
    }
    const url = created.stdout
      .trim()
      .split("\n")
      .findLast(line => line.startsWith("https://"));
    return { place: "github", ...(url === undefined ? {} : { url }) };
  },
};
