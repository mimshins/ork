/**
 * @file The Worktrees panel's words, as pure functions: counts, a row's second
 *   line, what Remove… and Clean merged… say at each step, and their CLI twins.
 *   An item's state parts and a plan's lines are core's words, sent by the
 *   server (the CLI says the same); these only arrange them.
 */

import type {
  RemovePlanAnswer,
  WorktreeRow,
  WorktreesProject,
} from "@krapht/ork-server/client";

import { quoted } from "./run-form.ts";

/** `3 worktrees`, `1 branch`. */
export const counted = (count: number, noun: string): string =>
  `${String(count)} ${noun}${count === 1 ? "" : noun.endsWith("h") ? "es" : "s"}`;

const tally = (items: readonly WorktreeRow[]) => ({
  worktrees: items.filter(item => item.path !== null).length,
  branches: items.filter(item => item.path === null).length,
});

/** `6 worktrees · 2 branches`, a branch being one with no worktree. */
export const countWords = (items: readonly WorktreeRow[]): string => {
  const { worktrees, branches } = tally(items);
  const parts = [
    ...(worktrees > 0 || branches === 0
      ? [counted(worktrees, "worktree")]
      : []),
    ...(branches > 0 ? [counted(branches, "branch")] : []),
  ];
  return parts.join(" · ");
};

/** What a filter change says: `4 worktrees and 1 branch in app.` */
export const countSaid = (
  projects: readonly WorktreesProject[],
  scope: string | null,
): string => {
  const items = projects.flatMap(project => project.items);
  const { worktrees, branches } = tally(items);
  const where =
    scope ??
    counted(projects.filter(p => p.items.length > 0).length, "project");
  if (items.length === 0) return `No Ork worktrees or branches in ${where}.`;
  const what = [
    ...(worktrees > 0 ? [counted(worktrees, "worktree")] : []),
    ...(branches > 0 ? [counted(branches, "branch")] : []),
  ].join(" and ");
  return `${what} in ${where}.`;
};

/** Why Clean merged… can't be pressed now, if it can't. */
export const cleanBlocked = (
  projects: readonly WorktreesProject[] | null,
  one: boolean,
  /** The list's read failed, with nothing read before it. */
  failed: boolean,
): string | null => {
  if (projects === null) {
    return failed ? "the worktrees couldn't be read" : "reading worktrees";
  }
  if (projects.some(p => p.items.some(item => item.state === "merged"))) {
    return null;
  }
  return one
    ? "nothing merged into the current branch"
    : "nothing merged in these projects";
};

/** A card's line under its name: where, against what, how many. */
export const headMeta = (project: WorktreesProject): string[] => [
  project.root,
  // A project git couldn't read has no branch to say.
  ...(project.error === undefined
    ? [
        project.head === null
          ? "detached HEAD"
          : `current branch ${project.head}`,
      ]
    : []),
  ...(project.items.length === 0 ? [] : [countWords(project.items)]),
];

/** A row's second line, part by part; `risk` parts are work removing loses. */
export const rowParts = (
  row: WorktreeRow,
): { text: string; risk: boolean }[] => [
  { text: `run ${row.runId}`, risk: false },
  { text: row.nodeId, risk: false },
  ...(row.path === null ? [] : [{ text: row.path, risk: false }]),
  ...row.parts,
  ...(row.cleanKeeps === undefined
    ? []
    : [{ text: `clean keeps it: ${row.cleanKeeps}`, risk: false }]),
];

export const openRunName = (row: WorktreeRow): string =>
  row.run.known
    ? `Open run ${row.runId} at ${row.nodeId}`
    : `Open run ${row.runId}: it isn't in Ork's records`;

/** `Remove ork/9b1e07/lead…`, with why it can't be, when it can't. */
export const removeName = (row: WorktreeRow): string => {
  const verb = row.remove.label.replace("…", "");
  const name = `${verb} ${row.label}…`;
  return row.remove.refusal === undefined
    ? name
    : `${name}: ${row.remove.refusal}`;
};

/** Remove…'s CLI twin, from the project's root, where `remove` resolves. */
export const removeTwin = (
  root: string,
  key: string,
  deleteBranch: boolean,
  force: boolean,
): string =>
  `cd ${quoted(root)} && ork worktrees remove ${quoted(key)}${deleteBranch ? " --branch" : ""}${force ? " --force" : ""}`;

type Kind = "branch" | "detached" | "worktree";

export const kindOf = (row: WorktreeRow): Kind => {
  if (row.path === null) return "branch";
  return row.state === "detached" || row.branch === undefined
    ? "detached"
    : "worktree";
};

export const removeTitle = (row: WorktreeRow): string =>
  ({
    branch: `Delete branch \`${row.label}\``,
    detached: `Remove the worktree of \`${row.label}\``,
    worktree: `Remove \`${row.label}\``,
  })[kindOf(row)];

export const removeDescription = (row: WorktreeRow, root: string): string => {
  const kind = kindOf(row);
  const base =
    kind === "branch"
      ? `It has no worktree. Deletes the branch from \`${root}\`.`
      : kind === "detached"
        ? "Removes the detached worktree. It has no branch of Ork's."
        : row.missing
          ? "Its folder is gone. Removing it drops git's record of the worktree. The branch stays unless you delete it too."
          : "Removes its worktree. The branch stays unless you delete it too.";
  return row.checkedOut === undefined
    ? base
    : `${base} It's on \`${row.checkedOut}\`, the workflow's own branch, which Ork never deletes; removing the worktree loses nothing committed.`;
};

/** The "Also delete the branch" box's words under it. */
export const branchHint = (
  state: { merged: boolean; ahead: number },
  head: string,
): string =>
  state.merged
    ? `It's merged into \`${head}\`.`
    : `It has ${counted(state.ahead, "commit")} not merged into \`${head}\`; deleting it loses them.`;

export const removeAction = (plan: RemovePlanAnswer): string => {
  if (plan.force) return "Continue…";
  if (plan.removeWorktree && plan.deleteBranch) {
    return "Remove worktree and branch";
  }
  if (plan.deleteBranch) return "Delete branch";
  return plan.prunes ? "Prune" : "Remove worktree";
};

/** Why the next step is needed: what removing loses. */
export const forceReason = (plan: RemovePlanAnswer): string | null => {
  if (!plan.force) return null;
  const { losing } = plan;
  if (losing.changes.length > 0) {
    return "It has uncommitted changes; the next step shows what's lost.";
  }
  const commits = counted(
    losing.commits.length + losing.more.commits,
    "commit",
  );
  return losing.commitsOn === "no branch"
    ? `It holds ${commits} on no branch; the next step shows them.`
    : `Deleting the branch loses ${commits}; the next step shows them.`;
};

/** What a done removal says aloud. */
export const removedSaid = (
  row: WorktreeRow,
  plan: RemovePlanAnswer,
): string => {
  if (plan.removeWorktree && plan.deleteBranch) {
    return `Removed ${row.label}'s worktree and deleted its branch.`;
  }
  if (plan.deleteBranch) return `Deleted branch ${row.label}.`;
  return plan.prunes
    ? `Pruned ${row.label}'s missing worktree.`
    : `Removed ${row.label}'s worktree.`;
};

/** The note under what's lost: only the sentences that apply. */
export const lostNote = (plan: RemovePlanAnswer): string =>
  [
    ...(plan.losing.changes.length > 0
      ? ["Uncommitted changes can't be recovered."]
      : []),
    ...(plan.losing.commits.length > 0
      ? ["Deleted commits stay only in git's reflog, until it expires."]
      : []),
  ].join(" ");

/** Clean merged…'s CLI twin, from the project's root. */
export const cleanTwin = (root: string, branches: boolean): string =>
  `cd ${quoted(root)} && ork worktrees clean${branches ? " --branches" : ""}`;
