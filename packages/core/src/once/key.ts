/**
 * @file The key of a check run once (`ork once`, `verify: { once: true }`): the
 *   working tree's files as a git tree (tracked and untracked, not ignored),
 *   written through a temporary index so the real one is untouched, with `HEAD`
 *   and the repository's common git folder, where passes are kept for every
 *   worktree. The key is the files, not the commit: a commit or a no-op rebase
 *   keeps it.
 */

import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { git, gitOk } from "../worktree/git.ts";

export type TreeKey = {
  /** The id of the git tree of the working tree's files. */
  tree: string;
  /** The commit `HEAD` names, or `null` in a repository with no commit. */
  head: string | null;
  /** The repository's common git folder, shared by its worktrees. */
  commonDir: string;
};

/**
 * The key of the files in the worktree at `cwd`. Rejects outside a git
 * repository. Starts from a copy of the real index, so git hashes only the
 * files whose stat changed.
 */
export const treeKeyOf = async (cwd: string): Promise<TreeKey> => {
  const [commonDir = "", index = ""] = (
    await gitOk(cwd, ["rev-parse", "--git-common-dir", "--git-path", "index"])
  )
    .split("\n")
    .map(line => path.resolve(cwd, line.trim()));
  const scratch = mkdtempSync(path.join(tmpdir(), "ork-once-"));
  const env = { GIT_INDEX_FILE: path.join(scratch, "index") };
  try {
    if (existsSync(index)) copyFileSync(index, env.GIT_INDEX_FILE);
    await gitOk(cwd, ["add", "-A"], env);
    const tree = (await gitOk(cwd, ["write-tree"], env)).trim();
    const head = await git(cwd, ["rev-parse", "--verify", "-q", "HEAD"]);
    return {
      tree,
      head: head.code === 0 ? head.stdout.trim() : null,
      commonDir,
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
};
