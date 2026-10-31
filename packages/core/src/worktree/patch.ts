/**
 * @file Moving work between worktrees without commits, for `merge: patch` and
 *   `commit: never`: a worktree's changes since a snapshot, as a binary patch
 *   with new files, applied to another worktree as uncommitted changes. Only
 *   the index of Ork's own worktrees is touched (`git add -A`, to see new
 *   files); nothing is committed.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { git, gitOk, lines } from "./git.ts";
import type { MergeResult } from "./manager.ts";

/** Stages everything and returns the tree it makes: a snapshot to diff from. */
export const snapshot = async (worktree: string): Promise<string> => {
  await gitOk(worktree, ["add", "-A"]);
  return (await gitOk(worktree, ["write-tree"])).trim();
};

/** The worktree's changes since `tree` (new files included), as a patch. */
export const changesSince = async (
  worktree: string,
  tree: string,
): Promise<string> => {
  await gitOk(worktree, ["add", "-A"]);
  return gitOk(worktree, [
    "diff-index",
    "--cached",
    "-p",
    "--binary",
    "--no-color",
    tree,
  ]);
};

/** Files a refused `git apply` names. */
const refused = (stderr: string): string[] => [
  ...new Set(
    lines(stderr).flatMap(line => {
      const match =
        /^error: patch failed: (.+):\d+$/u.exec(line) ??
        /^error: (.+?): (?:already exists in working directory|does not exist in index|No such file or directory|patch does not apply)$/u.exec(
          line,
        );
      return match?.[1] === undefined ? [] : [match[1]];
    }),
  ),
];

/**
 * Applies a patch to the worktree at `into`, uncommitted. All or nothing: when
 * any part does not apply, nothing changes and the files are named.
 */
export const applyChanges = async (
  into: string,
  patch: string,
): Promise<MergeResult> => {
  if (patch.trim() === "") return { ok: true };
  const dir = mkdtempSync(path.join(tmpdir(), "ork-patch-"));
  const file = path.join(dir, "changes.patch");
  try {
    writeFileSync(file, patch);
    const applied = await git(into, ["apply", "--binary", file]);
    if (applied.code === 0) return { ok: true };
    const reason = applied.stderr.trim().split("\n").at(-1);
    return {
      ok: false,
      conflicts: refused(applied.stderr),
      error: reason ?? "the patch did not apply",
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

/**
 * Makes the worktree at `worktree` match `from`'s current state, committed and
 * not: it moves to `from`'s commit, drops its own changes (ignored files stay),
 * and takes `from`'s uncommitted changes. Returns the snapshot it now has.
 */
export const syncFrom = async (
  worktree: string,
  from: string,
): Promise<string> => {
  const head = (await gitOk(from, ["rev-parse", "HEAD"])).trim();
  const own = await changesSince(from, head);
  await gitOk(worktree, ["reset", "-q", "--hard", head]);
  await gitOk(worktree, ["clean", "-fdq"]);
  const applied = await applyChanges(worktree, own);
  if (!applied.ok) {
    throw new Error(`could not take ${from}'s changes: ${applied.error}`);
  }
  return snapshot(worktree);
};
