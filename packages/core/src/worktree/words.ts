/**
 * @file The plain words for what `ork worktrees` shows, in one place, so the
 *   CLI and the Worktrees panel say the same thing: an item's name, its merge
 *   state, its state as parts (each marked when it's work that removing would
 *   lose), a plan's line, and why an item can't be removed. The CLI colors
 *   them; the panel lays them out.
 */

import { type CleanStep, stepPrunes } from "./clean.ts";
import type { OrkWorktree } from "./list.ts";

/** An item's name: its branch, or its run and node when created detached. */
export const labelOf = (item: OrkWorktree): string =>
  item.branch ?? `${item.runId}/${item.nodeId}`;

export type MergeState = "merged" | "unmerged" | "detached";

/** Merged into the current branch, not, or detached on no branch at all. */
export const mergeStateOf = (item: OrkWorktree): MergeState => {
  if (item.branch === undefined && item.checkedOut === undefined) {
    return "detached";
  }
  return item.merged ? "merged" : "unmerged";
};

export const MERGE_WORDS: Record<MergeState, string> = {
  merged: "merged",
  unmerged: "not merged",
  detached: "detached",
};

/** One part of an item's state; `risk` marks work that removing would lose. */
export type StatePart = { text: string; risk: boolean };

/** `3 commits`, `1 commit`. */
export const counted = (count: number, noun: string): string =>
  `${String(count)} ${noun}${count === 1 ? "" : "s"}`;

/**
 * An item's state, in order: where its worktree is when it isn't plain, the
 * workflow's own branch, uncommitted changes, unmerged or unreachable commits,
 * and the main checkout. `into` names the branch "not merged" is measured
 * against, when the words should say it.
 */
export const stateParts = (item: OrkWorktree, into?: string): StatePart[] => {
  const parts: StatePart[] = [];
  const part = (text: string, risk = false): void => {
    parts.push({ text, risk });
  };
  if (item.path === null) part("no worktree");
  else if (item.missing) part("missing (prunable)");
  if (item.checkedOut !== undefined) {
    part(`on the workflow's branch ${item.checkedOut}`);
  }
  if (item.dirty) part("uncommitted changes", true);
  const state = mergeStateOf(item);
  if (state === "unmerged") {
    const where = into === undefined ? "" : ` into ${into}`;
    part(`${counted(item.ahead, "commit")} not merged${where}`);
  }
  if (state === "detached") {
    if (item.ahead > 0)
      part(`${counted(item.ahead, "commit")} on no branch`, true);
    else if (item.path !== null && !item.missing) part("nothing committed");
  }
  if (item.inMainCheckout) part("checked out in the main checkout");
  return parts;
};

/** A plan's line for one item, its reason apart so it can be dimmed. */
export type PlanLine = { text: string; reason?: string };

/** What a step does, as a plan says it. */
export const planWhat = (step: CleanStep): string => {
  const actions = [
    ...(step.removeWorktree ? ["remove worktree"] : []),
    ...(stepPrunes(step) && !step.removeWorktree ? ["prune worktree"] : []),
    ...(step.deleteBranch ? ["delete branch"] : []),
  ];
  return actions.length > 0 ? actions.join(" + ") : "keep";
};

/** `ork/r1/lead: remove worktree`, `r1/check (detached): keep (…)`. */
export const planLine = (step: CleanStep): PlanLine => {
  const { item } = step;
  const name =
    item.branch === undefined && item.checkedOut === undefined
      ? `${labelOf(item)} (detached)`
      : labelOf(item);
  return {
    text: `${name}: ${planWhat(step)}`,
    ...(step.skip === undefined ? {} : { reason: step.skip }),
  };
};

/**
 * Why an item can't be removed at all, even forced, if it can't: the main
 * checkout holds it, or its run is still going.
 */
export const removeRefusal = (
  item: OrkWorktree,
  live: boolean,
): string | undefined => {
  if (item.inMainCheckout) {
    return "checked out in the main checkout; switch it to another branch first";
  }
  return live ? `run ${item.runId} is still going; stop it first` : undefined;
};
