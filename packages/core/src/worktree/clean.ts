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
  if (item.heldBy !== undefined) {
    return kept(item, `checked out in ${item.heldBy}`);
  }
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

/** Whether a step drops a worktree whose folder is gone, by its own path. */
export const stepPrunes = (step: CleanStep): boolean =>
  step.item.missing && step.item.path !== null && step.skip === undefined;

/** Whether a step does anything. */
export const stepActs = (step: CleanStep): boolean =>
  step.removeWorktree || step.deleteBranch || stepPrunes(step);

/**
 * What `ork worktrees clean` would do. A worktree with uncommitted changes, an
 * unmerged branch, or a detached worktree holding commits no branch has, is
 * kept unless `force`; one checked out in the main checkout or in a worktree
 * Ork didn't create, or whose run is still going, is kept even then.
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
 * Carries out one step; what it did goes into `done` as it goes. It touches
 * only its own item: a missing worktree is dropped by its own path (`git
 * worktree remove`), never by `git worktree prune`, which would drop every
 * missing worktree in the repository, the user's own included.
 */
export const applyStep = async (
  root: string,
  step: CleanStep,
  force: boolean,
  done: string[],
): Promise<void> => {
  const { item } = step;
  // A worktree whose folder is gone still holds its branch until dropped.
  if (stepPrunes(step) && !step.removeWorktree && item.path !== null) {
    await gitOk(root, ["worktree", "remove", item.path]);
    done.push(`pruned ${item.path}`);
  }
  if (step.removeWorktree && item.path !== null) {
    await removeWorktree(root, item.path, force);
    done.push(`removed ${item.path}`);
  }
  if (step.deleteBranch && item.branch !== undefined) {
    await gitOk(root, ["branch", force ? "-D" : "-d", item.branch]);
    done.push(`deleted ${item.branch}`);
  }
};

/**
 * Carries out a clean plan, step by step. What it did goes into `done` as it
 * goes, so a caller still has it when git fails halfway.
 */
export const applyClean = async (
  root: string,
  steps: readonly CleanStep[],
  force: boolean,
  done: string[] = [],
): Promise<string[]> => {
  for (const step of steps) {
    // oxlint-disable-next-line no-await-in-loop -- git takes one lock at a time
    await applyStep(root, step, force, done);
  }
  return done;
};
