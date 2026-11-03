/**
 * @file `ork prune` (ADR-046): which runs may lose their transcript, and doing
 *   it. A run goes with the runs it called or was called by, or not at all, and
 *   not while it is live, is linked, or has a worktree or branch left: those
 *   read the run's events. The usage ledger and feedback records stay.
 */

import { existsSync, rmSync } from "node:fs";

import { placeFor, runDirOf } from "../project/place.ts";
import { createdWorktrees, listOrkWorktrees } from "../worktree/list.ts";
import type { EventStore, RunRecord } from "./types.ts";
import { liveStatus } from "./view.ts";

export type PruneFilter = {
  /** Runs that ended before this ISO time. */
  before: string;
  /** Only this project's runs; every project's without it. */
  project?: string;
};

export type PrunePlan = {
  remove: RunRecord[];
  /** Runs old enough that had to stay, and why. */
  keep: { run: RunRecord; reason: string }[];
};

export type PruneOutcome = {
  /** How many runs were forgotten. */
  removed: number;
  /** How many of their folders were removed. */
  folders: number;
  /** What did not go as planned: a run that came back, a folder that stayed. */
  failed: { run: string; reason: string }[];
};

type WorktreesOf = (root: string) => Promise<ReadonlySet<string>>;

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * The runs in a project that still have a worktree or branch. With its folder
 * gone, or no longer a repository, there is nothing left to clean up; any other
 * failure says nothing about them, so it rejects.
 */
const runsWithWorktrees =
  (store: EventStore): WorktreesOf =>
  async root => {
    if (!existsSync(root)) return new Set();
    try {
      const found = await listOrkWorktrees(root, createdWorktrees(store, root));
      return new Set(found.map(w => w.runId));
    } catch (error) {
      if (/not a git repository/iu.test(messageOf(error))) return new Set();
      throw error;
    }
  };

/** The run at the top of a run's chain of calls. */
const callRootOf = (
  run: RunRecord,
  byId: ReadonlyMap<string, RunRecord>,
): string => {
  let top = run;
  const seen = new Set([run.id]);
  while (top.parent !== undefined) {
    const parent = byId.get(top.parent);
    if (parent === undefined || seen.has(parent.id)) break;
    seen.add(parent.id);
    top = parent;
  }
  return top.id;
};

/** Sorts the runs before the cutoff into those to remove and those to keep. */
export const planPrune = async (
  store: EventStore,
  filter: PruneFilter,
  worktreesOf: WorktreesOf = runsWithWorktrees(store),
): Promise<PrunePlan> => {
  const all = store.runs();
  const byId = new Map(all.map(run => [run.id, run]));
  const inScope = (run: RunRecord) =>
    filter.project === undefined || run.project === filter.project;
  // A chat with a run that ended long ago is recent activity.
  const old = (run: RunRecord) =>
    (store.lastEventAt(run.id) ?? run.finishedAt ?? run.startedAt) <
    filter.before;
  const trees = new Map<string, RunRecord[]>();
  for (const run of all) {
    const root = callRootOf(run, byId);
    trees.set(root, [...(trees.get(root) ?? []), run]);
  }
  const projects = [
    ...new Set(all.filter(r => old(r) && inScope(r)).map(r => r.project)),
  ];
  const withWorktrees = new Map<string, ReadonlySet<string> | string>(
    await Promise.all(
      projects.map(async project => {
        try {
          return [project, await worktreesOf(project)] as const;
        } catch (error) {
          return [project, messageOf(error)] as const;
        }
      }),
    ),
  );
  /** Why this run itself cannot go, or `null` when it can. */
  const blocker = (run: RunRecord): string | null => {
    if (liveStatus(run) === "running") return "it is still running";
    const worktrees = withWorktrees.get(run.project);
    if (typeof worktrees === "string") {
      return `cannot tell whether it has a worktree left: ${worktrees}`;
    }
    if (worktrees?.has(run.id) === true) {
      return "it has a worktree or branch left (ork worktrees clean)";
    }
    if (store.links({ run: run.id, live: true }).length > 0) {
      return "it has a live link";
    }
    return null;
  };
  const plan: PrunePlan = { remove: [], keep: [] };
  for (const tree of trees.values()) {
    const held = tree
      .map(run => {
        if (!inScope(run))
          return `run ${run.id} of its call is in another project (--all)`;
        if (!old(run)) return `run ${run.id} of its call is newer`;
        const why = blocker(run);
        return why === null ? null : `run ${run.id} of its call stays: ${why}`;
      })
      .find(why => why !== null);
    for (const run of tree) {
      if (!inScope(run) || !old(run)) continue;
      if (held === undefined) {
        plan.remove.push(run);
      } else {
        plan.keep.push({ run, reason: blocker(run) ?? held });
      }
    }
  }
  return plan;
};

const SAFE_ID = /^[\w-]+$/u;

/** Forgets the plan's runs and removes their folders. */
export const applyPrune = (
  store: EventStore,
  plan: Pick<PrunePlan, "remove">,
): PruneOutcome => {
  const outcome: PruneOutcome = { removed: 0, folders: 0, failed: [] };
  const places = store.projects();
  for (const run of plan.remove) {
    if (!store.deleteRun(run.id)) {
      outcome.failed.push({ run: run.id, reason: "it is running again" });
      continue;
    }
    outcome.removed += 1;
    if (!SAFE_ID.test(run.id)) continue;
    // A registered project's own place, even with its folder gone.
    const place =
      places.find(p => p.root === run.project) ?? placeFor(run.project, places);
    const folder = runDirOf(place, run.id);
    if (!existsSync(folder)) continue;
    try {
      rmSync(folder, { recursive: true, force: true });
      outcome.folders += 1;
    } catch (error) {
      outcome.failed.push({
        run: run.id,
        reason: `its folder stays, at ${folder}: ${messageOf(error)}`,
      });
    }
  }
  return outcome;
};
