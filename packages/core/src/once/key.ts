/**
 * @file The key of a check run once (`ork once`, `verify: { once: true }`): the
 *   working tree's files as a git tree (tracked and untracked, not ignored),
 *   written through a temporary index so the real one is untouched, with `HEAD`
 *   and the repository's common git folder, where passes are kept for every
 *   worktree. The key is the files, not the commit: a commit or a no-op rebase
 *   keeps it. With pathspecs (`--on`), only the files they match count.
 */

import { createHash } from "node:crypto";
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
  /**
   * With pathspecs: the sha256 of the files they match (`git ls-files -s`),
   * used in place of `tree`. Absent without them.
   */
  files?: string;
  /** The pathspecs `files` was taken on; absent or empty for the whole tree. */
  on?: readonly string[];
};

export type TreeKeyOptions = {
  /** Git pathspecs, relative to `cwd`, the check depends on. */
  on?: readonly string[];
};

/**
 * Git rejected the pathspecs, or they match no file: a usage error, never a
 * silent hit.
 */
export class OncePathspecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OncePathspecError";
  }
}

/** The part of the key a pass is matched on: the files, else the tree. */
export const filesOf = (key: TreeKey): string => key.files ?? key.tree;

/**
 * The key of the files in the worktree at `cwd`. Rejects outside a git
 * repository, and with `OncePathspecError` when git rejects `on` or it matches
 * no file. Starts from a copy of the real index, so git hashes only the files
 * whose stat changed.
 */
export const treeKeyOf = async (
  cwd: string,
  { on = [] }: TreeKeyOptions = {},
): Promise<TreeKey> => {
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
    const key: TreeKey = {
      tree,
      head: head.code === 0 ? head.stdout.trim() : null,
      commonDir,
    };
    if (on.length === 0) return key;
    // Full names, so the same pathspec from two folders never lists alike.
    const listed = await git(
      cwd,
      ["ls-files", "-s", "-z", "--full-name", "--", ...on],
      env,
    );
    if (listed.code !== 0) {
      throw new OncePathspecError(
        `git rejected the pathspecs ${on.join(" ")}: ${listed.stderr.trim()}`,
      );
    }
    // A key on no file would pass for ever after the first run: a typo, likely.
    if (listed.stdout === "") {
      throw new OncePathspecError(
        `the pathspecs ${on.join(" ")} match no file: check them, or drop --on to key every file`,
      );
    }
    const files = createHash("sha256").update(listed.stdout).digest("hex");
    return { ...key, files, on: [...on] };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
};
