/**
 * @file A run's own working root (RFC-021 Option C): a worktree made from a
 *   base commit beside the clone, named by the project's git rules like any
 *   node's (`ork-<run>-audit-root` on `ork/<run>/audit-root`, or detached under
 *   `commit: never`), that every node of the run works in instead of the user's
 *   checkout. Opening it again at the recorded commit re-creates it on resume,
 *   or adopts the folder a stopped run left. Closing removes it with force (it
 *   holds untracked files Ork wrote) and deletes its branch only while the
 *   branch still points at the base, so no commit is lost.
 */

import { existsSync, lstatSync, realpathSync } from "node:fs";

import type { ResolvedGitRules } from "@krapht/ork-schema";

import { git, gitOk, lines } from "./git.ts";
import { type WorktreeEvent, worktreeEvent } from "./handoff.ts";
import { createWorktree } from "./manager.ts";
import { type NameInputs, namesFor } from "./names.ts";
import { repoRoot } from "./remove.ts";

/** The run root's node id: in its name, its branch and its `worktree` events. */
export const RUN_ROOT_ID = "audit-root";

/** A run's own worktree, open. */
export type RunRoot = {
  /** The worktree's folder: every node's working root. */
  path: string;
  /** `undefined` when it is detached (`commit: never`). */
  branch?: string;
  /** The commit it was made from, resolved: record it to re-create on resume. */
  base: string;
  /** The user's checkout it was made from. */
  source: string;
  /** Whether a folder a stopped run left was adopted rather than created. */
  adopted: boolean;
  /**
   * Removes the worktree, untracked files and all, and its branch while that is
   * still at `base`. Idempotent; a folder already gone is no error.
   */
  close: () => Promise<void>;
};

/** The commit `ref` names in `root`, or an error naming it. */
const commitOf = async (root: string, ref: string): Promise<string> => {
  // A ref starting with `-` would reach git as an option.
  const resolved = ref.startsWith("-")
    ? { code: 1, stdout: "" }
    : await git(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  if (resolved.code !== 0) {
    throw new Error(`${ref} is not a commit in ${root}`);
  }
  return resolved.stdout.trim();
};

/** Whether `folder` is one of the worktrees git lists for `root`. */
const isWorktreeOf = async (root: string, folder: string): Promise<boolean> => {
  const listed = lines(await gitOk(root, ["worktree", "list", "--porcelain"]))
    .filter(line => line.startsWith("worktree "))
    .map(line => line.slice("worktree ".length))
    .filter(listedPath => existsSync(listedPath))
    .map(listedPath => realpathSync(listedPath));
  return listed.includes(realpathSync(folder));
};

/** Whether anything, a dangling link included, is at `at`. */
const occupied = (at: string): boolean => {
  try {
    lstatSync(at);
    return true;
  } catch {
    return false;
  }
};

/**
 * Whether a stopped run's worktree is at `at` to adopt; refuses a link, or a
 * folder that is not this repository's worktree.
 */
const adoptable = async (root: string, at: string): Promise<boolean> => {
  if (!occupied(at)) return false;
  if (lstatSync(at).isSymbolicLink()) {
    throw new Error(
      `the run's worktree path ${at} is a link; Ork never follows one`,
    );
  }
  if (!(await isWorktreeOf(root, at))) {
    throw new Error(`${at} already exists and is not a worktree of ${root}`);
  }
  return true;
};

/** Each step is idempotent by itself, so closing twice is no error. */
const closer =
  (root: string, at: string, base: string, branch?: string) =>
  async (): Promise<void> => {
    // `remove --force` also drops git's record of a folder already gone.
    const removed = await git(root, ["worktree", "remove", "--force", at]);
    if (removed.code !== 0 && occupied(at)) {
      const reason = removed.stderr.trim().split("\n").at(-1) ?? "";
      throw new Error(
        `could not remove the run's worktree at ${at}: ${reason}`,
      );
    }
    // Deleted only while it is still at the base: a commit on it is kept.
    if (branch !== undefined) {
      await git(root, ["update-ref", "-d", `refs/heads/${branch}`, base]);
    }
  };

/**
 * Opens a run's own worktree in the repository at `root`, from `base` (`HEAD`
 * for a new run, the recorded commit on resume): named by the git rules,
 * created there, or adopted when a stopped run left it. `known` says this run
 * created the branch before (a resume), so it may be checked out again. Throws
 * an error naming the cause when `root` is no repository, `base` no commit, the
 * path a link or a stranger's folder, or `git worktree add` fails.
 */
export const openRunRoot = async (options: {
  root: string;
  runId: string;
  rules: ResolvedGitRules;
  base: string;
  inputs?: NameInputs;
  known?: boolean;
}): Promise<RunRoot> => {
  const { root, runId, rules } = options;
  if ((await repoRoot(root)) === null) {
    throw new Error(
      `${root} is not a git repository; the run needs one for its worktree`,
    );
  }
  const base = await commitOf(root, options.base);
  const names = await namesFor({
    rules,
    root,
    runId,
    nodeId: RUN_ROOT_ID,
    inputs: options.inputs ?? {},
  });
  const adopted = await adoptable(root, names.path);
  if (!adopted) {
    try {
      await createWorktree({
        root,
        path: names.path,
        ...(names.branch === undefined ? {} : { branch: names.branch }),
        base,
        known: options.known === true,
        // Only the commit: no ignored file of the checkout (`.env`, local agent files).
        copyLocal: false,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `could not create the run's worktree at ${names.path}: ${reason}`,
        { cause: error },
      );
    }
  }
  return {
    path: names.path,
    ...(names.branch === undefined ? {} : { branch: names.branch }),
    base,
    source: root,
    adopted,
    close: closer(root, names.path, base, names.branch),
  };
};

/**
 * The `worktree` event recording the run root's `created` or `removed`, so `ork
 * worktrees` and clean find a crash's leftover by its run even when it is
 * detached and on no `ork/` branch.
 */
export const runRootEvent = (
  root: Pick<RunRoot, "path" | "branch">,
  action: "created" | "removed",
): WorktreeEvent => worktreeEvent(RUN_ROOT_ID, action, root);
