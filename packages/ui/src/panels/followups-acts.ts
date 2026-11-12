/**
 * @file The Follow-ups panel's buttons: which an item has by its status (with
 *   the CLI each one stands for, and whether the server allows it), what is
 *   said aloud once one is done, which row takes the choice when the chosen one
 *   leaves the list, and the note when pull requests can't be checked.
 */

import type {
  FollowUpActionCheck,
  FollowUpActions,
} from "@krapht/ork-server/client";

import { type FollowUpRow, short } from "./followups-model.ts";

/** One button of an item: what it says, does, and stands for in the CLI. */
export type Act = {
  key: "due" | "done" | "drop" | "reopen";
  word: string;
  cli: string;
  variant: "primary" | "default";
  check: FollowUpActionCheck;
};

const ALLOWED: FollowUpActionCheck = { ok: true };

/**
 * The buttons an item has by its status, in the table's order; whether each is
 * enabled is the server's answer, with the list's own status until it comes.
 */
export const actsFor = (f: FollowUpRow, actions?: FollowUpActions): Act[] => {
  const id = short(f.id);
  const check = (key: Act["key"] | "done"): FollowUpActionCheck =>
    actions?.[key] ?? ALLOWED;
  const finish = (primary: boolean): Act => ({
    key: "done",
    word: f.kind === "message" ? "Mark sent" : "Mark done",
    cli: `ork follow-ups done ${id}`,
    variant: primary ? "primary" : "default",
    check: check("done"),
  });
  const drop: Act = {
    key: "drop",
    word: "Drop",
    cli: `ork follow-ups drop ${id}`,
    variant: "default",
    check: check("drop"),
  };
  if (f.status === "waiting") {
    return [
      {
        key: "due",
        word: "Mark due",
        cli: `ork follow-ups due ${id}`,
        variant: "default",
        check: check("due"),
      },
      finish(false),
      drop,
    ];
  }
  if (f.status === "due") return [finish(true), drop];
  return [
    {
      key: "reopen",
      word: "Reopen",
      cli: `ork follow-ups reopen ${id}`,
      variant: "default",
      check: check("reopen"),
    },
  ];
};

/** A disabled action's name ends with its reason. */
export const labelOf = (word: string, check: FollowUpActionCheck): string =>
  check.ok ? word : `${word}: ${check.why}`;

/** What is said aloud once the server did it. */
export const doneWords = (act: Act["key"], f: FollowUpRow): string => {
  const title = f.title;
  if (act === "done")
    return `${f.kind === "message" ? "Marked sent" : "Marked done"}: ${title}.`;
  if (act === "drop") return `Dropped: ${title}.`;
  if (act === "due") return `Marked due: ${title}.`;
  return `Reopened: ${title}, ${f.due === "now" ? "due" : "waiting"}.`;
};

/** The next row to take the choice when the chosen one leaves the list. */
export const nextAfter = (
  before: readonly FollowUpRow[],
  after: readonly FollowUpRow[],
  gone: string,
): FollowUpRow | undefined => {
  const at = before.findIndex(f => f.id === gone);
  const left = after.filter(f => f.id !== gone);
  return left[Math.min(Math.max(at, 0), left.length - 1)];
};

/** The note when pull requests can't be checked; the command follows it. */
export const checkerWords = (errors: readonly string[]): string =>
  `Can't check PRs: ${errors.some(e => e.includes("gh")) ? "`gh` isn't signed in" : (errors[0] ?? "no reason given")}. After-merge follow-ups stay waiting. Run this in a terminal:`;
