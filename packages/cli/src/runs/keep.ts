/**
 * @file What keeping or discarding the change of a built-in that proposes one
 *   (`ork:feedback-apply`, `ork:onboard-write`) does to the project. On a
 *   branch, the branch stays when it holds commits. Under `commit: never` the
 *   worker's worktree is detached and its change uncommitted: keeping applies
 *   it to the project's checkout, still uncommitted, for the person to commit;
 *   a run seeded from an attached project's Ork folder (ADR-114, recorded in
 *   its settings) applies it to that folder instead, never to the repository.
 *   Either way, a run with nothing to keep, or a discarded one, leaves no
 *   worktree or branch behind.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

import {
  applyChanges,
  applyClean,
  changesSince,
  createdWorktrees,
  type EventStore,
  listOrkWorktrees,
  planClean,
  withoutGitLocalEnv,
} from "@krapht/ork-core";

import { prefixOf } from "../run/run-root.ts";

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
  /**
   * The change is in the checkout, uncommitted, or (a seeded run: `into` is
   * Ork's folder for the project, ADR-114) in that folder; the worktree is
   * gone.
   */
  | { kept: "applied"; files: string[]; removed: string[]; into?: string }
  /** There was nothing to keep; the worktree and branch are gone. */
  | { kept: "none"; removed: string[] }
  /** The change did not apply over the checkout (or folder); nothing changed. */
  | {
      kept: "refused";
      worktree: string;
      conflicts: string[];
      error: string;
      into?: string;
    };

/** The folder a run's worktrees were seeded from, as its start recorded it. */
const seedFolder = (store: EventStore, runId: string): string | undefined =>
  store
    .events(runId)
    .map(({ event }) => event)
    .flatMap(event =>
      event.type === "run.started" && event.settings?.seed !== undefined
        ? [event.settings.seed]
        : [],
    )
    .at(0);

/**
 * The writer's change in a seeded run's worktree, as a patch relative to the
 * project's `.ork/`. `.ork` may be gitignored in the repository, so it is
 * staged with `-f`: `finish` already vetted what is in it.
 */
const seededPatch = (root: string, worktree: string): Promise<string> => {
  const dir = `${prefixOf(root)}.ork`;
  if (existsSync(path.join(worktree, dir))) {
    execFileSync("git", ["add", "-f", "--", dir], {
      cwd: worktree,
      env: withoutGitLocalEnv(process.env),
      stdio: "ignore",
    });
  }
  return changesSince(worktree, "HEAD", `${dir}/`);
};

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
  const folder = seedFolder(store, runId);
  const patch =
    worker.worktree === ""
      ? ""
      : folder === undefined
        ? await changesSince(worker.worktree, "HEAD")
        : await seededPatch(root, worker.worktree);
  if (patch.trim() === "") {
    return { kept: "none", removed: await discardRun(store, root, runId) };
  }
  // A seeded run's folder may lack `workflows/` (git creates it) or even exist.
  if (folder !== undefined) mkdirSync(folder, { recursive: true });
  const applied = await applyChanges(folder ?? root, patch, {
    plainFolder: folder !== undefined,
  });
  const into = folder === undefined ? {} : { into: folder };
  if (!applied.ok) {
    return {
      kept: "refused",
      worktree: worker.worktree,
      conflicts: applied.conflicts,
      error: applied.error,
      ...into,
    };
  }
  return {
    kept: "applied",
    files: patchFiles(patch),
    removed: await discardRun(store, root, runId),
    ...into,
  };
};
