/**
 * @file What `ork worktrees` shows: every worktree and branch Ork's runs
 *   recorded creating, whatever the project's git rules named them, and any
 *   `ork/*` branch besides, with their state read from git itself. What clean
 *   and remove do with them is clean.ts.
 */

import { existsSync } from "node:fs";

import type { EventStore } from "../store/types.ts";
import { git, gitOk, lines } from "./git.ts";
import { BRANCH_PREFIX } from "./manager.ts";

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
  /**
   * A run recorded creating it. An `ork/` branch no run recorded is the user's:
   * listed, never removed or deleted.
   */
  recorded: boolean;
  /** `null` for a branch without a worktree. */
  path: string | null;
  /** The worktree's directory is gone; clean and remove drop it by its path. */
  missing: boolean;
  /** Uncommitted changes in the worktree. */
  dirty: boolean;
  /** How many: the worktree's `git status --porcelain` lines. */
  changes: number;
  /**
   * Commits on the branch (or `checkedOut`) that the current branch does not
   * have; for a detached worktree, commits on no branch at all (a `tool.git`
   * commit).
   */
  ahead: number;
  /**
   * Fully merged into the current branch; for a detached worktree, its HEAD is
   * already part of the current branch's history.
   */
  merged: boolean;
  /** Checked out in the main checkout itself, which clean never removes. */
  inMainCheckout: boolean;
  /**
   * The path of a worktree Ork didn't create that has the branch checked out;
   * nothing removes the item while it does.
   */
  heldBy?: string;
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

/**
 * The `ork/<run>/<node>` branches of runs that recorded nothing; with no path
 * recorded, the worktree is whichever has the branch checked out.
 */
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

/**
 * Whether a detached worktree's HEAD is already in the current branch's
 * history.
 */
const headIsMerged = async (root: string, path: string): Promise<boolean> => {
  const head = await git(path, ["rev-parse", "HEAD"]);
  return (
    head.code === 0 &&
    (
      await git(root, [
        "merge-base",
        "--is-ancestor",
        head.stdout.trim(),
        "HEAD",
      ])
    ).code === 0
  );
};

/** One created worktree or branch, with its state read from git. */
const stateOf = async (
  root: string,
  entries: readonly Entry[],
  item: CreatedWorktree,
  recorded: boolean,
): Promise<OrkWorktree> => {
  const { branch } = item;
  // A recorded worktree is the one at its recorded path, whatever branch it
  // is on now: a user's own worktree of the same branch is not Ork's.
  const entry =
    branch === undefined || item.path !== ""
      ? entries.find(e => e.path === item.path)
      : entries.find(e => e.branch === branch);
  // Who else has the branch checked out: the main checkout, or a worktree of
  // the user's own, which git won't let the branch be deleted from under.
  const holder =
    branch === undefined
      ? undefined
      : entries.find(e => e.branch === branch && e.path !== entry?.path);
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
  const changes = lines(status).length;
  const merged =
    on === undefined
      ? entry !== undefined &&
        !missing &&
        (await headIsMerged(root, entry.path))
      : ahead === 0;
  return {
    ...(branch === undefined ? {} : { branch }),
    ...(checkedOut === undefined ? {} : { checkedOut }),
    runId: item.runId,
    nodeId: item.nodeId,
    recorded,
    path: entry?.path ?? null,
    missing,
    dirty: changes > 0,
    changes,
    ahead: Number.isNaN(ahead) ? 0 : ahead,
    merged,
    inMainCheckout: entry?.path === root || holder?.path === root,
    ...(holder === undefined || holder.path === root
      ? {}
      : { heldBy: holder.path }),
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
    ...created
      .filter(c =>
        c.branch === undefined
          ? entries.some(e => e.path === c.path)
          : branches.includes(c.branch),
      )
      .map(item => ({ item, recorded: true })),
    ...branches
      .filter(b => b.startsWith(BRANCH_PREFIX) && !recordedBranches.has(b))
      .map(b => ({ item: prefixed(b), recorded: false })),
  ];
  return Promise.all(
    items.map(({ item, recorded }) => stateOf(root, entries, item, recorded)),
  );
};
