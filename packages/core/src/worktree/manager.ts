/**
 * @file Ork's git worktrees: one per `worktree` node, beside the clone, by
 *   default in `../<clone>-worktrees/ork-<run>-<node>` on branch
 *   `ork/<run>/<node>` (ADR-020; a project's git rules rename them, ADR-032).
 *   Ork only creates, commits, merges and removes what its runs created; it
 *   never pushes.
 */

import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
} from "node:fs";
import path from "node:path";

import { git, gitOk, lines } from "./git.ts";

export const BRANCH_PREFIX = "ork/";

/** A worktree Ork made; `branch` is absent when it is detached. */
export type Worktree = { path: string; branch?: string };

/** Gitignored files a session needs as much in a worktree as in the clone. */
export const LOCAL_AGENT_FILES = [
  "CLAUDE.local.md",
  ".claude/settings.local.json",
] as const;

/** Where the project's instructions, skills and agents live. */
const AGENT_PATHSPECS = [
  ":(glob)**/CLAUDE.md",
  ":(glob)**/AGENTS.md",
  ".claude",
  ".agents",
];

/** The default branch name, `ork/<run>/<node>`. */
export const branchName = (runId: string, nodeId: string): string =>
  `${BRANCH_PREFIX}${runId}/${nodeId}`;

/** `../<clone>-worktrees/`: beside the clone, never inside it. */
export const worktreeHome = (root: string): string =>
  path.join(path.dirname(root), `${path.basename(root)}-worktrees`);

/** The default worktree folder, `../<clone>-worktrees/ork-<run>-<node>`. */
export const worktreePath = (
  root: string,
  runId: string,
  nodeId: string,
): string => path.join(worktreeHome(root), `ork-${runId}-${nodeId}`);

export type ProjectState = {
  root: string;
  /** The commit root nodes branch from. */
  head: string;
  /** Uncommitted instructions, skills or agents (worktrees lack them). */
  dirtyAgentFiles: string[];
  /** How many other paths have uncommitted changes. */
  dirtyOther: number;
};

/** Symlinked agent folders (e.g. `.claude/skills -> ../.ai/skills`), as targets. */
const symlinkTargets = (root: string): string[] => {
  const targets: string[] = [];
  for (const dir of [".claude", ".agents"]) {
    const base = path.join(root, dir);
    if (!existsSync(base) || !lstatSync(base).isDirectory()) continue;
    for (const name of ["skills", "agents", "commands", "rules"]) {
      const link = path.join(base, name);
      if (!existsSync(link) || !lstatSync(link).isSymbolicLink()) continue;
      const target = path.resolve(base, readlinkSync(link));
      const relative = path.relative(root, target);
      if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
        targets.push(relative);
      }
    }
  }
  return [...new Set(targets)];
};

const statusPaths = async (
  root: string,
  pathspecs: readonly string[],
): Promise<string[]> => {
  const out = await gitOk(root, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "--",
    ...pathspecs,
  ]);
  return lines(out).map(line => line.slice(3));
};

/** The project's git root, head, and what a worktree would be missing. */
export const inspectProject = async (
  cwd: string,
): Promise<ProjectState | null> => {
  const top = await git(cwd, ["rev-parse", "--show-toplevel"]);
  if (top.code !== 0) return null;
  const root = top.stdout.trim();
  const head = await git(root, ["rev-parse", "HEAD"]);
  if (head.code !== 0) return null;
  const agent = await statusPaths(root, [
    ...AGENT_PATHSPECS,
    ...symlinkTargets(root),
  ]);
  const all = await statusPaths(root, ["."]);
  return {
    root,
    head: head.stdout.trim(),
    dirtyAgentFiles: agent,
    dirtyOther: all.length - agent.length,
  };
};

/**
 * The gitignored files to copy into a new worktree: every local agent file, and
 * what the repo's `.worktreeinclude` lists (Claude Code's convention). Only
 * files that are also gitignored qualify, so tracked files are never copied.
 */
export const localFiles = async (root: string): Promise<string[]> => {
  const include = path.join(root, ".worktreeinclude");
  const candidates = lines(
    await gitOk(root, [
      "ls-files",
      "--others",
      "--ignored",
      ...LOCAL_AGENT_FILES.map(f => `--exclude=${f}`),
      ...(existsSync(include) ? [`--exclude-from=${include}`] : []),
    ]),
  );
  if (candidates.length === 0) return [];
  const ignored = await git(root, ["check-ignore", "--", ...candidates]);
  return lines(ignored.stdout);
};

const copyInto = (from: string, to: string, files: readonly string[]) => {
  const copied: string[] = [];
  for (const file of files) {
    const target = path.join(to, file);
    if (existsSync(target) || !existsSync(path.join(from, file))) continue;
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(path.join(from, file), target, { verbatimSymlinks: true });
    copied.push(file);
  }
  return copied;
};

/**
 * Creates a worktree at `path` from `base`, with the local files: on a new
 * `branch`, or detached when there is none (`commit: never`). An existing
 * branch is checked out again only when this run created it (`known`): a
 * resumed run's branch outlives its removed worktree. Any other existing branch
 * stops it: Ork never takes over a branch it did not create.
 */
export const createWorktree = async (options: {
  root: string;
  path: string;
  branch?: string;
  base: string;
  known?: boolean;
}): Promise<Worktree & { copied: string[]; reused: boolean }> => {
  const { root, branch, base } = options;
  const target = options.path;
  mkdirSync(path.dirname(target), { recursive: true });
  if (branch === undefined) {
    await gitOk(root, ["worktree", "add", "--detach", target, base]);
    const copied = copyInto(root, target, await localFiles(root));
    return { path: target, copied, reused: false };
  }
  const exists =
    (
      await git(root, [
        "rev-parse",
        "--verify",
        "--quiet",
        `refs/heads/${branch}`,
      ])
    ).code === 0;
  if (exists && options.known !== true) {
    throw new Error(
      `branch ${branch} already exists, and this run did not create it; Ork never takes over a branch it did not create`,
    );
  }
  await gitOk(
    root,
    exists
      ? ["worktree", "add", target, branch]
      : ["worktree", "add", "-b", branch, target, base],
  );
  const copied = copyInto(root, target, await localFiles(root));
  return { path: target, branch, copied, reused: exists };
};

/** Copies files that exist in `from` and are missing in the worktree. */
export const carryFiles = (
  from: string,
  worktree: string,
  files: readonly string[],
): string[] =>
  copyInto(
    from,
    worktree,
    files.filter(f => !path.isAbsolute(f) && !f.split(/[\\/]/u).includes("..")),
  );

/**
 * Commits what a session left uncommitted. The repo's hooks run; when they
 * refuse, the error says why and the worktree keeps the changes.
 */
export const commitLeftovers = async (
  worktree: string,
  message: string,
): Promise<boolean> => {
  const status = await gitOk(worktree, ["status", "--porcelain"]);
  if (lines(status).length === 0) return false;
  await gitOk(worktree, ["add", "-A"]);
  await gitOk(worktree, ["commit", "-m", message]);
  return true;
};

/**
 * Moves a worktree's branch up to `branch` when it is behind and has nothing of
 * its own, e.g. a child's branch after its owner merged it and moved on.
 */
export const fastForward = async (
  worktree: string,
  branch: string,
): Promise<boolean> =>
  (await git(worktree, ["merge", "--ff-only", "-q", branch])).code === 0;

export type MergeResult =
  | { ok: true }
  | { ok: false; conflicts: string[]; error: string };

/**
 * Merges `branch` into the checkout at `into` with `--no-ff`; aborts on
 * conflict.
 */
export const mergeBranch = async (
  into: string,
  branch: string,
  message: string,
): Promise<MergeResult> => {
  const merged = await git(into, [
    "merge",
    "--no-ff",
    "--no-edit",
    "-m",
    message,
    branch,
  ]);
  if (merged.code === 0) return { ok: true };
  const conflicts = lines(
    (await git(into, ["diff", "--name-only", "--diff-filter=U"])).stdout,
  );
  await git(into, ["merge", "--abort"]);
  const reason = (merged.stdout + merged.stderr).trim().split("\n").at(-1);
  return { ok: false, conflicts, error: reason ?? "the merge failed" };
};

export const removeWorktree = async (
  root: string,
  worktree: string,
  force = false,
): Promise<void> => {
  await gitOk(root, [
    "worktree",
    "remove",
    ...(force ? ["--force"] : []),
    worktree,
  ]);
};
