/**
 * @file A minimal `git` runner for the worktree manager: arguments without a
 *   shell, results that never throw, and none of git's local variables (a
 *   hook's `GIT_DIR` or `GIT_INDEX_FILE`), so it acts on the repository at
 *   `cwd` (specs/worktrees.md). Commands in one folder run one at a time: two
 *   children handed their owner's work at once both stage it (`git add -A`),
 *   and git refuses the second while the first holds the index's lock.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import { withoutGitLocalEnv } from "./git-env.ts";

export type GitResult = { code: number; stdout: string; stderr: string };

/** The last command queued in each folder, so the next one waits for it. */
const queues = new Map<string, Promise<unknown>>();

/** Runs `task` after every command queued earlier in the same folder. */
const inTurn = <T>(cwd: string, task: () => Promise<T>): Promise<T> => {
  const key = path.resolve(cwd);
  const next = (queues.get(key) ?? Promise.resolve()).then(task, task);
  queues.set(key, next);
  void next.finally(() => {
    if (queues.get(key) === next) queues.delete(key);
  });
  return next;
};

const runGit = (
  cwd: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<GitResult> =>
  new Promise(resolve => {
    execFile(
      "git",
      args,
      {
        cwd,
        env: { ...withoutGitLocalEnv(process.env), ...env },
        maxBuffer: 32 * 1024 * 1024,
        encoding: "utf8",
      },
      (error, stdout, stderr) => {
        const code =
          error === null ? 0 : typeof error.code === "number" ? error.code : -1;
        const missing = error !== null && !existsSync(cwd);
        resolve({
          code,
          stdout,
          stderr: missing
            ? `the folder ${cwd} doesn't exist`
            : stderr || (error?.message ?? ""),
        });
      },
    );
  });

/**
 * Runs `git` with arguments (no shell) in `cwd`. Never throws. `env` adds
 * variables, such as a temporary `GIT_INDEX_FILE`.
 */
export const git = (
  cwd: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv = {},
): Promise<GitResult> => inTurn(cwd, () => runGit(cwd, args, env));

/** Like `git`, but rejects with git's message when the command fails. */
export const gitOk = async (
  cwd: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv = {},
): Promise<string> => {
  const result = await git(cwd, args, env);
  if (result.code !== 0) {
    const reason = result.stderr.trim().split("\n").at(-1) ?? "";
    throw new Error(`git ${args[0] ?? ""} failed: ${reason}`);
  }
  return result.stdout;
};

/** Output lines without the trailing empty one. */
export const lines = (text: string): string[] =>
  text.split("\n").filter(line => line !== "");
