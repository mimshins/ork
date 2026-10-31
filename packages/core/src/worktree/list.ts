/**
 * @file What `ork worktrees` shows and cleans: every worktree and branch Ork's
 *   runs recorded creating, whatever the project's git rules named them, and
 *   any `ork/*` branch besides, with their state read from git itself.
 */

import { existsSync } from "node:fs";

import type { EventStore } from "../store/types.ts";
import { git, gitOk, lines } from "./git.ts";
import { BRANCH_PREFIX, removeWorktree } from "./manager.ts";

export type OrkWorktree = {
  /** `undefined` for a detached worktree (`commit: never`). */
  branch?: string;
  /**
   * The branch a worktree created detached is on now, made by the workflow
   * itself (a `tool.git` `switch -c`); Ork never deletes it.
   */
  checkedOut?: string;
  runId: string;
  nodeId: string;
  /** `null` for a branch without a worktree. */
  path: string | null;
  /** The worktree's directory is gone; `git worktree prune` drops it. */
  missing: boolean;
  /** Uncommitted changes in the worktree. */
  dirty: boolean;
  /**
   * Commits on the branch (or `checkedOut`) that the current branch does not
   * have; for a detached worktree, commits on no branch at all (a `tool.git`
   * commit).
   */
  ahead: number;
  /** Fully merged into the current branch (never, for a detached worktree). */
  merged: boolean;
  /** Checked out in the main checkout itself, which clean never removes. */
  inMainCheckout: boolean;
};

/** A worktree a run recorded creating (its `worktree` `created` event). */
export type CreatedWorktree = {
  runId: string;
  nodeId: string;
  path: string;
  branch?: string;
};

/**
 * The worktrees the project's runs recorded creating, oldest run first; one
 * entry per branch or folder, from the latest run that created it.
 */
export const createdWorktrees = (
  store: Pick<EventStore, "runs" | "events">,
  project: string,
): CreatedWorktree[] => {
  const byName = new Map<string, CreatedWorktree>();
  for (const run of store.runs({ project }).toReversed()) {
    for (const { event } of store.events(run.id)) {
      if (event.type !== "worktree" || event.action !== "created") continue;
      byName.set(event.branch ?? event.path, {
        runId: run.id,
        nodeId: event.id,
        path: event.path,
        ...(event.branch === undefined ? {} : { branch: event.branch }),
      });
    }
  }
  return [...byName.values()];
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

/** The `ork/<run>/<node>` branches of runs that recorded nothing. */
const prefixed = (branch: string): CreatedWorktree => {
  const [, runId = "", ...rest] = branch.split("/");
  return { runId, nodeId: rest.join("/"), path: "", branch };
};

/** How many commits a detached worktree holds that no branch, tag or remote has. */
const onNoBranch = async (entry: Entry | undefined): Promise<string> =>
  entry === undefined
    ? "0"
    : (
        await git(entry.path, [
          "rev-list",
          "--count",
          "HEAD",
          "--not",
          "--branches",
          "--tags",
          "--remotes",
        ])
      ).stdout;

/** One created worktree or branch, with its state read from git. */
const stateOf = async (
  root: string,
  entries: readonly Entry[],
  item: CreatedWorktree,
): Promise<OrkWorktree> => {
  const { branch } = item;
  const entry =
    branch === undefined
      ? entries.find(e => e.path === item.path)
      : entries.find(e => e.branch === branch);
  const missing =
    entry !== undefined && (entry.prunable || !existsSync(entry.path));
  const status =
    entry === undefined || missing
      ? ""
      : (await git(entry.path, ["status", "--porcelain"])).stdout;
  // A worktree created detached may be on a branch the workflow made since.
  const checkedOut =
    branch === undefined && entry !== undefined && entry.branch !== ""
      ? entry.branch
      : undefined;
  const on = branch ?? checkedOut;
  const counted =
    on === undefined
      ? await onNoBranch(entry === undefined || missing ? undefined : entry)
      : (await git(root, ["rev-list", "--count", `HEAD..${on}`])).stdout;
  const ahead = Number(counted);
  return {
    ...(branch === undefined ? {} : { branch }),
    ...(checkedOut === undefined ? {} : { checkedOut }),
    runId: item.runId,
    nodeId: item.nodeId,
    path: entry?.path ?? null,
    missing,
    dirty: lines(status).length > 0,
    ahead: Number.isNaN(ahead) ? 0 : ahead,
    merged: on !== undefined && ahead === 0,
    inMainCheckout: entry?.path === root,
  };
};

/**
 * Every worktree and branch Ork's runs created in the repository at `root`,
 * with its state: those the runs recorded (`created`, whatever the project's
 * git rules named them), and any `ork/` branch besides. A recorded one that git
 * no longer has is left out.
 */
export const listOrkWorktrees = async (
  root: string,
  created: readonly CreatedWorktree[] = [],
): Promise<OrkWorktree[]> => {
  const entries = parsePorcelain(
    await gitOk(root, ["worktree", "list", "--porcelain"]),
  );
  const branches = lines(
    await gitOk(root, [
      "for-each-ref",
      "--format=%(refname:short)",
      "refs/heads/",
    ]),
  );
  const recordedBranches = new Set(created.flatMap(c => c.branch ?? []));
  const items = [
    ...created.filter(c =>
      c.branch === undefined
        ? entries.some(e => e.path === c.path)
        : branches.includes(c.branch),
    ),
    ...branches
      .filter(b => b.startsWith(BRANCH_PREFIX) && !recordedBranches.has(b))
      .map(b => prefixed(b)),
  ];
  return Promise.all(items.map(item => stateOf(root, entries, item)));
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
  if (
    item.branch === undefined &&
    item.checkedOut === undefined &&
    item.ahead > 0 &&
    !options.force
  ) {
    return {
      item,
      removeWorktree: false,
      deleteBranch: false,
      skip: "commits on no branch",
    };
  }
  const removable = item.path !== null && !item.missing;
  if (
    options.branches &&
    item.branch !== undefined &&
    !item.merged &&
    !options.force
  ) {
    return {
      item,
      removeWorktree: removable,
      deleteBranch: false,
      skip: "branch not merged",
    };
  }
  return {
    item,
    removeWorktree: removable,
    deleteBranch: options.branches && item.branch !== undefined,
  };
};

/**
 * What `ork worktrees clean` would do. A worktree with uncommitted changes, an
 * unmerged branch, or a detached worktree holding commits no branch has, is
 * kept unless `force`.
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
    if (step.deleteBranch && item.branch !== undefined) {
      // oxlint-disable-next-line no-await-in-loop -- git takes one lock at a time
      await gitOk(root, ["branch", force ? "-D" : "-d", item.branch]);
      done.push(`deleted ${item.branch}`);
    }
  }
  await gitOk(root, ["worktree", "prune"]);
  return done;
};
