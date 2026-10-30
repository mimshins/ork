/**
 * @file What `ork worktrees` shows and cleans: every `ork/*` branch of the repo
 *   and its worktree, read from git itself, so nothing can drift.
 */

import { existsSync } from "node:fs";

import { git, gitOk, lines } from "./git.ts";
import { BRANCH_PREFIX, removeWorktree } from "./manager.ts";

export type OrkWorktree = {
  branch: string;
  runId: string;
  nodeId: string;
  /** `null` for a branch without a worktree. */
  path: string | null;
  /** The worktree's directory is gone; `git worktree prune` drops it. */
  missing: boolean;
  /** Uncommitted changes in the worktree. */
  dirty: boolean;
  /** Commits on the branch that the current branch does not have. */
  ahead: number;
  /** Fully merged into the current branch. */
  merged: boolean;
  /** Checked out in the main checkout itself, which clean never removes. */
  inMainCheckout: boolean;
};

type Entry = { path: string; branch: string; prunable: boolean };

const parsePorcelain = (text: string): Entry[] =>
  text
    .split("\n\n")
    .map(block => lines(block))
    .map(fields => {
      const value = (key: string) =>
        fields.find(f => f.startsWith(`${key} `))?.slice(key.length + 1);
      return {
        path: value("worktree") ?? "",
        branch: (value("branch") ?? "").replace(/^refs\/heads\//u, ""),
        prunable: fields.some(f => f.startsWith("prunable")),
      };
    })
    .filter(entry => entry.path !== "");

/** Every Ork branch of the repository at `root`, with its worktree's state. */
export const listOrkWorktrees = async (
  root: string,
): Promise<OrkWorktree[]> => {
  const entries = parsePorcelain(
    await gitOk(root, ["worktree", "list", "--porcelain"]),
  );
  const branches = lines(
    await gitOk(root, [
      "for-each-ref",
      "--format=%(refname:short)",
      `refs/heads/${BRANCH_PREFIX}`,
    ]),
  );
  return Promise.all(
    branches.map(async branch => {
      const [, runId = "", ...rest] = branch.split("/");
      const entry = entries.find(e => e.branch === branch);
      const missing =
        entry !== undefined && (entry.prunable || !existsSync(entry.path));
      const status =
        entry === undefined || missing
          ? ""
          : (await git(entry.path, ["status", "--porcelain"])).stdout;
      const ahead = Number(
        (await git(root, ["rev-list", "--count", `HEAD..${branch}`])).stdout,
      );
      return {
        branch,
        runId,
        nodeId: rest.join("/"),
        path: entry?.path ?? null,
        missing,
        dirty: lines(status).length > 0,
        ahead: Number.isNaN(ahead) ? 0 : ahead,
        merged: ahead === 0,
        inMainCheckout: entry?.path === root,
      };
    }),
  );
};

export type CleanFilter = {
  runId?: string;
  /** Only branches merged into the current branch. */
  merged: boolean;
};

export type CleanStep = {
  item: OrkWorktree;
  removeWorktree: boolean;
  deleteBranch: boolean;
  /** Why the item is left alone, when it is. */
  skip?: string;
};

const cleanStep = (
  item: OrkWorktree,
  options: { branches: boolean; force: boolean },
): CleanStep => {
  if (item.inMainCheckout) {
    return {
      item,
      removeWorktree: false,
      deleteBranch: false,
      skip: "checked out in the main checkout",
    };
  }
  if (item.dirty && !options.force) {
    return {
      item,
      removeWorktree: false,
      deleteBranch: false,
      skip: "uncommitted changes",
    };
  }
  const removable = item.path !== null && !item.missing;
  if (options.branches && !item.merged && !options.force) {
    return {
      item,
      removeWorktree: removable,
      deleteBranch: false,
      skip: "branch not merged",
    };
  }
  return { item, removeWorktree: removable, deleteBranch: options.branches };
};

/**
 * What `ork worktrees clean` would do. A worktree with uncommitted changes, or
 * an unmerged branch, is kept unless `force`.
 */
export const planClean = (
  items: readonly OrkWorktree[],
  filter: CleanFilter,
  options: { branches: boolean; force: boolean },
): CleanStep[] =>
  items
    .filter(item => filter.runId === undefined || item.runId === filter.runId)
    .filter(item => !filter.merged || item.merged)
    .map(item => cleanStep(item, options));

/** Carries out a clean plan, then prunes stale worktree entries. */
export const applyClean = async (
  root: string,
  steps: readonly CleanStep[],
  force: boolean,
): Promise<string[]> => {
  const done: string[] = [];
  // A worktree whose directory is gone still holds its branch until pruned.
  await gitOk(root, ["worktree", "prune"]);
  for (const step of steps) {
    const { item } = step;
    if (step.removeWorktree && item.path !== null) {
      // oxlint-disable-next-line no-await-in-loop -- git takes one lock at a time
      await removeWorktree(root, item.path, force);
      done.push(`removed ${item.path}`);
    }
    if (step.deleteBranch) {
      // oxlint-disable-next-line no-await-in-loop -- git takes one lock at a time
      await gitOk(root, ["branch", force ? "-D" : "-d", item.branch]);
      done.push(`deleted ${item.branch}`);
    }
  }
  await gitOk(root, ["worktree", "prune"]);
  return done;
};
