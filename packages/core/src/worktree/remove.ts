/**
 * @file What `ork worktrees remove` and the Worktrees panel's Remove… share: a
 *   project's items with the runs still going, the plan for one item (by the
 *   same rule as clean), whether it needs `force` because it loses work, the
 *   work it would lose as git prints it, and carrying it out.
 */

import type { EventStore } from "../store/types.ts";
import { liveStatus } from "../store/view.ts";
import { type CleanStep, cleanStep, keyOf, stepPrunes } from "./clean.ts";
import { git, gitOk, lines } from "./git.ts";
import {
  createdWorktrees,
  listOrkWorktrees,
  type OrkWorktree,
} from "./list.ts";
import { removeWorktree } from "./manager.ts";
import { labelOf, removeRefusal } from "./words.ts";

export type ProjectWorktrees = {
  items: OrkWorktree[];
  /** The project's runs still going, whose worktrees nothing removes. */
  live: ReadonlySet<string>;
};

/** The ids of the project's runs whose process is still going. */
export const liveRunIds = (
  store: Pick<EventStore, "runs">,
  root: string,
): Set<string> =>
  new Set(
    store
      .runs({ project: root })
      .filter(run => liveStatus(run) === "running")
      .map(run => run.id),
  );

/**
 * Whether `root` is a repository with a commit, and the branch checked out
 * there, which "merged" means merged into (null when its HEAD is detached).
 */
export const projectHead = async (
  root: string,
): Promise<{ ok: true; branch: string | null } | { ok: false }> => {
  const head = await git(root, ["rev-parse", "--verify", "--quiet", "HEAD"]);
  if (head.code !== 0) return { ok: false };
  const answer = await git(root, ["symbolic-ref", "--short", "-q", "HEAD"]);
  return { ok: true, branch: answer.code === 0 ? answer.stdout.trim() : null };
};

/** What Ork created in the repo at `root`, from its runs' records and git. */
export const readWorktrees = async (
  store: Pick<EventStore, "runs" | "events">,
  root: string,
): Promise<ProjectWorktrees> => ({
  items: await listOrkWorktrees(root, createdWorktrees(store, root)),
  live: liveRunIds(store, root),
});

export type RemovePlan = {
  step: CleanStep;
  /** Removing loses work (changes, unmerged or unreachable commits). */
  force: boolean;
};

export type Planned =
  | { ok: true; plan: RemovePlan }
  | { ok: false; error: string; gone: boolean };

/**
 * The plan to remove one item, named by `keyOf`. A branch with no worktree is
 * removed by deleting it, so `deleteBranch` is implied there.
 */
export const planRemove = (
  { items, live }: ProjectWorktrees,
  key: string,
  deleteBranch: boolean,
): Planned => {
  const item = items.find(i => keyOf(i) === key);
  if (item === undefined) {
    return {
      ok: false,
      error: `No Ork worktree or branch ${key}.`,
      gone: true,
    };
  }
  const refusal = removeRefusal(item, live.has(item.runId));
  if (refusal !== undefined) {
    return {
      ok: false,
      error: `Can't remove ${labelOf(item)}: ${refusal}.`,
      gone: false,
    };
  }
  const branches =
    item.branch !== undefined && (deleteBranch || item.path === null);
  const careful = cleanStep(item, { branches, force: false, live });
  if (careful.skip === undefined) {
    return { ok: true, plan: { step: careful, force: false } };
  }
  const step = cleanStep(item, { branches, force: true, live });
  return { ok: true, plan: { step, force: true } };
};

/** Work a removal would lose, as git prints it. */
export type LostWork = {
  /** `git status --porcelain` lines. */
  changes: string[];
  /** `git log --oneline` lines. */
  commits: string[];
  /** Whose commits: an unmerged branch's, or a detached worktree's. */
  commitsOn: "unmerged" | "no branch" | null;
};

const out = async (cwd: string, args: readonly string[]): Promise<string[]> =>
  lines((await git(cwd, args)).stdout);

/** What carrying out `plan` would lose, read from git. */
export const lostWork = async (
  root: string,
  { step }: RemovePlan,
): Promise<LostWork> => {
  const { item } = step;
  const inside = item.path !== null && !item.missing ? item.path : null;
  const changes =
    inside !== null && item.dirty && step.removeWorktree
      ? await out(inside, ["status", "--porcelain"])
      : [];
  if (step.deleteBranch && item.branch !== undefined && !item.merged) {
    const commits = await out(root, [
      "log",
      "--oneline",
      `HEAD..${item.branch}`,
    ]);
    return { changes, commits, commitsOn: "unmerged" };
  }
  const detached = item.branch === undefined && item.checkedOut === undefined;
  if (detached && inside !== null && item.ahead > 0 && step.removeWorktree) {
    const commits = await out(inside, [
      "log",
      "--oneline",
      "HEAD",
      "--not",
      "--branches",
      "--tags",
      "--remotes",
    ]);
    return { changes, commits, commitsOn: "no branch" };
  }
  return { changes, commits: [], commitsOn: null };
};

/**
 * Carries out a remove plan; what it did goes into `done` as it goes. The
 * caller has checked that a plan needing `force` was asked to force. It touches
 * only its own item: a missing worktree is dropped by its own path, never by
 * `git worktree prune`, which would drop every missing one.
 */
export const applyRemove = async (
  root: string,
  { step, force }: RemovePlan,
  done: string[] = [],
): Promise<string[]> => {
  const { item } = step;
  if (stepPrunes(step) && !step.removeWorktree && item.path !== null) {
    await gitOk(root, ["worktree", "remove", item.path]);
    done.push(`pruned ${item.path}`);
  }
  if (step.removeWorktree && item.path !== null) {
    await removeWorktree(root, item.path, force);
    done.push(`removed ${item.path}`);
  }
  if (step.deleteBranch && item.branch !== undefined) {
    await gitOk(root, ["branch", force ? "-D" : "-d", item.branch]);
    done.push(`deleted ${item.branch}`);
  }
  return done;
};
