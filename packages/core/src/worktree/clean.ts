/**
 * @file What `ork worktrees clean` and `ork worktrees remove` do with what
 *   list.ts reads: the plan (what goes, what's kept and why), by one rule for
 *   every caller, and carrying it out. The CLI and the Worktrees panel both
 *   plan here, so neither removes what the other would keep.
 */

import { gitOk } from "./git.ts";
import type { OrkWorktree } from "./list.ts";
import { removeWorktree } from "./manager.ts";

export type CleanFilter = {
  runId?: string;
  /** Only branches merged into the current branch. */
  merged: boolean;
  /** Only this item: its branch, or a detached worktree's path (`keyOf`). */
  key?: string;
};

export type CleanOptions = {
  branches: boolean;
  force: boolean;
  /** The runs still going, whose worktrees are kept even with `force`. */
  live?: ReadonlySet<string>;
};

export type CleanStep = {
  item: OrkWorktree;
  removeWorktree: boolean;
  deleteBranch: boolean;
  /** Why the item is left alone, when it is. */
  skip?: string;
};

/** What names an item for `remove`: its branch, or its worktree's path. */
export const keyOf = (item: OrkWorktree): string =>
  item.branch ?? item.path ?? `${item.runId}/${item.nodeId}`;

/** The reasons no `force` overrides: removing would break something. */
const MAIN_CHECKOUT = "checked out in the main checkout";
const RUN_GOING = "its run is still going";

const kept = (item: OrkWorktree, skip: string): CleanStep => ({
  item,
  removeWorktree: false,
  deleteBranch: false,
  skip,
});

/** What clean does with one item. */
export const cleanStep = (
  item: OrkWorktree,
  options: CleanOptions,
): CleanStep => {
  if (item.inMainCheckout) return kept(item, MAIN_CHECKOUT);
  if (options.live?.has(item.runId) === true) return kept(item, RUN_GOING);
  if (item.dirty && !options.force) return kept(item, "uncommitted changes");
  if (
    item.branch === undefined &&
    item.checkedOut === undefined &&
    item.ahead > 0 &&
    !options.force
  ) {
    return kept(item, "commits on no branch");
  }
  const removable = item.path !== null && !item.missing;
  if (
    options.branches &&
    item.branch !== undefined &&
    !item.merged &&
    !options.force
  ) {
    return {
      item,
      removeWorktree: removable,
      deleteBranch: false,
      skip: "branch not merged",
    };
  }
  return {
    item,
    removeWorktree: removable,
    deleteBranch: options.branches && item.branch !== undefined,
  };
};

/** Whether a step drops a worktree whose folder is gone (`git worktree prune`). */
export const stepPrunes = (step: CleanStep): boolean =>
  step.item.missing && step.item.path !== null && step.skip === undefined;

/** Whether a step does anything. */
export const stepActs = (step: CleanStep): boolean =>
  step.removeWorktree || step.deleteBranch || stepPrunes(step);

/**
 * What `ork worktrees clean` would do. A worktree with uncommitted changes, an
 * unmerged branch, or a detached worktree holding commits no branch has, is
 * kept unless `force`; one checked out in the main checkout, or whose run is
 * still going, is kept even then.
 */
export const planClean = (
  items: readonly OrkWorktree[],
  filter: CleanFilter,
  options: CleanOptions,
): CleanStep[] =>
  items
    .filter(item => filter.runId === undefined || item.runId === filter.runId)
    .filter(item => filter.key === undefined || keyOf(item) === filter.key)
    .filter(item => !filter.merged || item.merged)
    .map(item => cleanStep(item, options));

/**
 * Carries out a clean plan, then prunes stale worktree entries. What it did
 * goes into `done` as it goes, so a caller still has it when git fails
 * halfway.
 */
export const applyClean = async (
  root: string,
  steps: readonly CleanStep[],
  force: boolean,
  done: string[] = [],
): Promise<string[]> => {
  // A worktree whose directory is gone still holds its branch until pruned.
  await gitOk(root, ["worktree", "prune"]);
  for (const step of steps) {
    const { item } = step;
    if (stepPrunes(step) && !step.removeWorktree) {
      done.push(`pruned ${String(item.path)}`);
    }
    if (step.removeWorktree && item.path !== null) {
      // oxlint-disable-next-line no-await-in-loop -- git takes one lock at a time
      await removeWorktree(root, item.path, force);
      done.push(`removed ${item.path}`);
    }
    if (step.deleteBranch && item.branch !== undefined) {
      // oxlint-disable-next-line no-await-in-loop -- git takes one lock at a time
      await gitOk(root, ["branch", force ? "-D" : "-d", item.branch]);
      done.push(`deleted ${item.branch}`);
    }
  }
  await gitOk(root, ["worktree", "prune"]);
  return done;
};
