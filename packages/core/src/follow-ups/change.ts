/**
 * @file What a person does to a follow-up, the same in `ork follow-ups` and the
 *   server's routes: find one by a prefix of its id, and mark it done (a
 *   message: sent), drop it, reopen it, or make it due now. Each action says
 *   why it refuses a follow-up in the wrong status.
 */

import type { FollowUpRows } from "../store/follow-ups.ts";
import type { FollowUp, FollowUpStatus } from "./types.ts";

export const FOLLOW_UP_ACTIONS = ["done", "drop", "reopen", "due"] as const;
export type FollowUpAction = (typeof FOLLOW_UP_ACTIONS)[number];

export type FollowUpFound =
  | { ok: true; followUp: FollowUp }
  | { ok: false; error: string };

/** The project's follow-up whose id is, or starts with, `prefix`. */
export const findFollowUp = (
  rows: FollowUpRows,
  project: string,
  prefix: string,
): FollowUpFound => {
  const exact = rows.followUp(project, prefix);
  if (exact !== undefined) return { ok: true, followUp: exact };
  const matches =
    prefix === ""
      ? []
      : rows.followUps(project).filter(f => f.id.startsWith(prefix));
  const [only, other] = matches;
  if (only === undefined) {
    return { ok: false, error: `No follow-up \`${prefix}\` in this project.` };
  }
  if (other !== undefined) {
    return {
      ok: false,
      error: `\`${prefix}\` matches ${matches.map(f => f.id).join(", ")}; give more of the id.`,
    };
  }
  return { ok: true, followUp: only };
};

/** Which statuses each action starts from, and where it goes. */
const ACTIONS: Record<
  FollowUpAction,
  {
    from: readonly FollowUpStatus[];
    to: (f: FollowUp) => FollowUpStatus;
    note: string;
  }
> = {
  done: { from: ["waiting", "due"], to: () => "done", note: "done" },
  drop: { from: ["waiting", "due"], to: () => "dropped", note: "dropped" },
  reopen: {
    from: ["done", "dropped"],
    to: f => (f.due === "now" ? "due" : "waiting"),
    note: "reopened",
  },
  due: { from: ["waiting"], to: () => "due", note: "marked due" },
};

/** Why `action` can't be done to `f` now, or `undefined`. */
const refusal = (f: FollowUp, action: FollowUpAction): string | undefined => {
  const rule = ACTIONS[action];
  return rule.from.includes(f.status)
    ? undefined
    : `${f.id} is ${f.status}, so it can't be ${rule.note}.`;
};

/** Whether an action is allowed, and if not, why, short and whole. */
export type FollowUpActionCheck =
  | { ok: true }
  | { ok: false; why: string; error: string };

/** What can be done to a follow-up now: each action, or why not. */
export type FollowUpActions = Record<
  FollowUpAction | "post",
  FollowUpActionCheck
>;

const check = (f: FollowUp, action: FollowUpAction): FollowUpActionCheck => {
  const error = refusal(f, action);
  return error === undefined
    ? { ok: true }
    : { ok: false, why: `it is ${f.status}`, error };
};

const postCheck = (f: FollowUp): FollowUpActionCheck => {
  const open = f.status === "waiting" || f.status === "due";
  if (f.kind !== "message" || f.draft?.channel !== "github") {
    return {
      ok: false,
      why: "not drafted for the github channel",
      error:
        "only a message drafted for the github channel is posted; send the others yourself",
    };
  }
  return open
    ? { ok: true }
    : {
        ok: false,
        why: `it is ${f.status}`,
        error: `${f.id} is ${f.status}, so it is not posted.`,
      };
};

export const followUpActions = (f: FollowUp): FollowUpActions => ({
  done: check(f, "done"),
  drop: check(f, "drop"),
  reopen: check(f, "reopen"),
  due: check(f, "due"),
  post: postCheck(f),
});

/** Applies `action` to `followUp`, and keeps it. */
export const changeFollowUp = (
  rows: FollowUpRows,
  followUp: FollowUp,
  action: FollowUpAction,
  now: () => string = () => new Date().toISOString(),
): FollowUpFound => {
  const rule = ACTIONS[action];
  const refused = refusal(followUp, action);
  if (refused !== undefined) return { ok: false, error: refused };
  const { note: _old, ...rest } = followUp;
  const changed: FollowUp = {
    ...rest,
    status: rule.to(followUp),
    note: rule.note,
    updatedAt: now(),
  };
  rows.putFollowUp(changed);
  return { ok: true, followUp: changed };
};

export type FollowUpCause = "merged" | "overdue" | "closed-unmerged" | "marked";

/**
 * Why a due follow-up is due, read from the note `due.ts` left: its ref merged,
 * its date came, its ref closed unmerged, or a person marked it. `undefined`
 * for one that is not due, or was due from the start.
 */
export const dueCause = (f: FollowUp): FollowUpCause | undefined => {
  if (f.status !== "due" || f.note === undefined) return undefined;
  if (f.note.includes("closed without merging")) return "closed-unmerged";
  if (f.note.endsWith(" merged")) return "merged";
  if (f.note.startsWith("due on ")) return "overdue";
  return f.note === "marked due" ? "marked" : undefined;
};
