/**
 * @file What keeping or discarding the change of a built-in that proposes one
 *   (`ork:feedback-apply`, `ork:onboard-write`) does to the project. On a
 *   branch, the branch stays when it holds commits. Under `commit: never` the
 *   worker's worktree is detached and its change uncommitted: keeping applies
 *   it to the project's checkout, still uncommitted, for the person to commit.
 *   Either way, a run with nothing to keep, or a discarded one, leaves no
 *   worktree or branch behind.
 */

import {
  applyChanges,
  applyClean,
  changesSince,
  createdWorktrees,
  type EventStore,
  listOrkWorktrees,
  planClean,
} from "@krapht/ork-core";

/**
 * Removes what a run left in the repository at `root`: its worktrees and
 * branches.
 */
export const discardRun = async (
  store: EventStore,
  root: string,
  runId: string,
): Promise<string[]> => {
  const items = await listOrkWorktrees(root, createdWorktrees(store, root));
  const steps = planClean(
    items,
    { merged: false, runId },
    { branches: true, force: true },
  );
  return applyClean(
    root,
    steps.filter(s => s.removeWorktree || s.deleteBranch),
    true,
  );
};

/** How many commits the run's worktrees hold that the current branch hasn't. */
export const commitsAhead = async (
  store: EventStore,
  root: string,
  runId: string,
): Promise<number> =>
  (await listOrkWorktrees(root, createdWorktrees(store, root)))
    .filter(item => item.runId === runId)
    .reduce((sum, item) => sum + item.ahead, 0);

/** What keeping a run's change did. */
export type Kept =
  /** The branch holds commits and stays. */
  | { kept: "branch" }
  /** The change is in the checkout, uncommitted; the worktree is gone. */
  | { kept: "applied"; files: string[]; removed: string[] }
  /** There was nothing to keep; the worktree and branch are gone. */
  | { kept: "none"; removed: string[] }
  /** The change did not apply over the checkout; nothing changed. */
  | { kept: "refused"; worktree: string; conflicts: string[]; error: string };

/** The files a `git diff` patch touches, each once. */
const patchFiles = (patch: string): string[] => [
  ...new Set(
    [...patch.matchAll(/^diff --git a\/.+? b\/(.+)$/gmu)].map(m => m[1] ?? ""),
  ),
];

/**
 * Keeps a run's change: its branch when the worker had one (`branch` is not
 * empty), or else the uncommitted change in its `worktree`, applied to the
 * checkout at `root`. All or nothing: a change that does not apply over what
 * the checkout holds leaves both as they were.
 */
export const keepRun = async (
  store: EventStore,
  root: string,
  runId: string,
  worker: { branch: string; worktree: string },
  ahead: typeof commitsAhead = commitsAhead,
): Promise<Kept> => {
  if (worker.branch !== "") {
    return (await ahead(store, root, runId)) > 0
      ? { kept: "branch" }
      : { kept: "none", removed: await discardRun(store, root, runId) };
  }
  const patch =
    worker.worktree === "" ? "" : await changesSince(worker.worktree, "HEAD");
  if (patch.trim() === "") {
    return { kept: "none", removed: await discardRun(store, root, runId) };
  }
  const applied = await applyChanges(root, patch);
  if (!applied.ok) {
    return {
      kept: "refused",
      worktree: worker.worktree,
      conflicts: applied.conflicts,
      error: applied.error,
    };
  }
  return {
    kept: "applied",
    files: patchFiles(patch),
    removed: await discardRun(store, root, runId),
  };
};
