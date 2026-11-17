/**
 * @file Helpers for the tests of a run's own working root (RFC-021): a clone to
 *   register as an attached project, git, the run root's recorded events and
 *   where its worktree goes, and what the user's checkout holds (so a test sees
 *   that a run left it alone).
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  type EventStore,
  resumable,
  type RunRecord,
} from "@krapht/ork-core";

import type { registerProject } from "../../src/index.ts";

export const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" });

export const commit = (cwd: string, message: string) =>
  git(
    cwd,
    "-c",
    "user.name=T",
    "-c",
    "user.email=t@example.com",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--quiet",
    "--allow-empty",
    "-m",
    message,
  );

export const tmp = (prefix: string) =>
  realpathSync(mkdtempSync(path.join(tmpdir(), prefix)));

/**
 * A clone with one commit and an ignored secret that its `.worktreeinclude`
 * names (a node's worktree would get a copy; a run root must not); `dirty`
 * adds an uncommitted change to a tracked file.
 */
export const clone = (dirty = true) => {
  const root = path.join(tmp("ork-run-root-"), "app");
  mkdirSync(root, { recursive: true });
  writeFileSync(path.join(root, "index.js"), "console.log(1);\n");
  writeFileSync(path.join(root, ".gitignore"), ".env\n");
  writeFileSync(path.join(root, ".worktreeinclude"), ".env\n");
  git(root, "init", "--quiet");
  git(root, "add", "-A");
  commit(root, "base");
  writeFileSync(path.join(root, ".env"), "TOKEN=secret\n");
  if (dirty) writeFileSync(path.join(root, "index.js"), "console.log(2);\n");
  return root;
};

export const registered = (result: ReturnType<typeof registerProject>) => {
  if (!result.ok) throw new Error(result.error);
  return result.project;
};

export const onlyRun = (store: EventStore): RunRecord => {
  const [run] = store.runs();
  if (run === undefined) throw new Error("no run was recorded");
  return run;
};

export const readyToResume = (store: EventStore, record: RunRecord) => {
  const ready = resumable(store, record, {});
  if (!ready.ok) throw new Error(ready.error);
  return ready.state;
};

/** The run root's `worktree` event actions, in order. */
export const rootActions = (store: EventStore, runId: string): string[] =>
  store
    .events(runId)
    .map(({ event }) => event)
    .flatMap(event =>
      event.type === "worktree" && event.id === "audit-root"
        ? [event.action]
        : [],
    );

/** The worktrees git lists for the clone at `root`. */
export const worktreesOf = (root: string): string[] =>
  git(root, "worktree", "list", "--porcelain")
    .split("\n")
    .filter(line => line.startsWith("worktree "))
    .map(line => line.slice("worktree ".length));

/** Where the run root of `runId` goes, beside the clone at `root`. */
export const rootOf = (root: string, runId: string): string =>
  path.join(path.dirname(root), "app-worktrees", `ork-${runId}-audit-root`);

/** The checkout as it is now. */
export const checkoutNow = (root: string) => ({
  status: git(root, "status", "--porcelain"),
  exclude: readFileSync(path.join(root, ".git", "info", "exclude"), "utf8"),
  orkThere: existsSync(path.join(root, ".ork")),
  worktrees: worktreesOf(root),
  branches: git(root, "branch", "--list", "ork/*"),
});
