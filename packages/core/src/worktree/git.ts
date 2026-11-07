/**
 * @file A minimal `git` runner for the worktree manager: arguments without a
 *   shell, results that never throw, and none of git's local variables (a
 *   hook's `GIT_DIR` or `GIT_INDEX_FILE`), so it acts on the repository at
 *   `cwd` (specs/worktrees.md).
 */

import { execFile } from "node:child_process";

import { withoutGitLocalEnv } from "./git-env.ts";

export type GitResult = { code: number; stdout: string; stderr: string };

/** Runs `git` with arguments (no shell) in `cwd`. Never throws. */
export const git = (cwd: string, args: readonly string[]): Promise<GitResult> =>
  new Promise(resolve => {
    execFile(
      "git",
      args,
      {
        cwd,
        env: withoutGitLocalEnv(process.env),
        maxBuffer: 32 * 1024 * 1024,
        encoding: "utf8",
      },
      (error, stdout, stderr) => {
        const code =
          error === null ? 0 : typeof error.code === "number" ? error.code : -1;
        resolve({ code, stdout, stderr: stderr || (error?.message ?? "") });
      },
    );
  });

/** Like `git`, but rejects with git's message when the command fails. */
export const gitOk = async (
  cwd: string,
  args: readonly string[],
): Promise<string> => {
  const result = await git(cwd, args);
  if (result.code !== 0) {
    const reason = result.stderr.trim().split("\n").at(-1) ?? "";
    throw new Error(`git ${args[0] ?? ""} failed: ${reason}`);
  }
  return result.stdout;
};

/** Output lines without the trailing empty one. */
export const lines = (text: string): string[] =>
  text.split("\n").filter(line => line !== "");
