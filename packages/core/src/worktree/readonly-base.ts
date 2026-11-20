/**
 * @file A run's shared read-only worktree (`git.readonly: base`): one detached
 *   worktree at the base, named by the git rules like a node's under a reserved
 *   id, holding only the commit (no ignored file of the checkout, such as
 *   `.env`), where readonly nodes with no owner and no input's worktree read
 *   instead of the user's checkout. Removed with force at the end, files an
 *   agent left there and all.
 */

import { existsSync } from "node:fs";

import type { ResolvedGitRules } from "@krapht/ork-schema";

import { git } from "./git.ts";
import type { Tracked } from "./handoff.ts";
import { createWorktree } from "./manager.ts";
import { type NameInputs, namesFor } from "./names.ts";

/**
 * Its id, in its name and its `worktree` events. Never a node's: node ids start
 * with a letter.
 */
export const READONLY_ID = "_readonly";

/** Opens the read-only worktree at `head`, detached whatever `git.commit` says. */
export const openReadonlyBase = async (options: {
  rules: ResolvedGitRules;
  root: string;
  runId: string;
  inputs: NameInputs;
  head: string;
}): Promise<Tracked> => {
  const { root } = options;
  const names = await namesFor({
    // `commit: never` names no branch: nothing is committed there.
    rules: { ...options.rules, commit: "never" },
    root,
    runId: options.runId,
    nodeId: READONLY_ID,
    inputs: options.inputs,
  });
  await createWorktree({
    root,
    path: names.path,
    base: options.head,
    copyLocal: false,
  });
  return { path: names.path };
};

/** The read-only worktree a crashed run left, when its folder is still there. */
export const leftReadonlyBase = (
  adopt: readonly { id: string; path: string }[],
): Tracked | undefined =>
  adopt
    .filter(left => left.id === READONLY_ID && existsSync(left.path))
    .map(left => ({ path: left.path }))[0];

/** Removes the read-only worktree; whether it is gone. */
export const removeReadonlyBase = async (
  root: string,
  worktree: Tracked,
): Promise<boolean> => {
  // `remove --force` also drops git's record of a folder already gone.
  const removed = await git(root, [
    "worktree",
    "remove",
    "--force",
    worktree.path,
  ]);
  return removed.code === 0 || !existsSync(worktree.path);
};
