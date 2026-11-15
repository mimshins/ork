/**
 * @file Following many runs at once (`ork logs -f --all`, `ork decide
 *   --follow`): each live top-level run through `followRunTree`, so a called
 *   run is reached through its caller and seen once, and a run that starts
 *   later found by polling the run list, since no socket announces a new run.
 */

import { setTimeout as sleep } from "node:timers/promises";

import type { EventStore, RunRecord } from "../store/types.ts";
import { liveStatus } from "../store/view.ts";
import { followRunTree, type TreeEvent } from "./follow-tree.ts";
import { createOrdered } from "./order-events.ts";

export type FollowRunsScope = {
  /** One project's runs (its root, absolute); `"all"` or absent: every one. */
  project?: string;
  /** Only runs of this workflow, and the runs they call. */
  workflow?: string;
  /** This run (a whole id) as the only root, called or not. */
  run?: string;
};

/** A followed run's event, with the run's workflow name. */
export type RunsEvent = TreeEvent & { workflow: string };

export type FollowRunsOptions = {
  /** End once no followed run is left and none is live in scope. */
  untilIdle?: boolean;
  /**
   * How often to read the run list for new runs (default 1000 ms); also how
   * often to poll a run that has no socket (default 250 ms) when given.
   */
  intervalMs?: number;
  /** `~`, for the runs' sockets; tests pass a folder. */
  home?: string;
  signal?: AbortSignal;
};

/** Why following stopped: `signal` aborted, or `untilIdle` found no live run. */
export type FollowRunsEnd = "aborted" | "idle";

/**
 * Calls `onEvent` for each event of the live runs in `scope` and of the runs
 * they call, once each, in store order `(at, run, seq)`: each is held
 * `intervalMs` (default 250 ms) so an earlier event polled later catches up.
 * Held events are delivered on `untilIdle`'s end, never once `signal` aborted
 * or a follower failed. Roots are the live runs with no `parent`, and a called
 * run whose caller is not followed (out of scope, or ended while it runs on). A
 * root's end does not end the watch.
 */
export const followRuns = async (
  store: EventStore,
  scope: FollowRunsScope,
  onEvent: (event: RunsEvent) => void,
  options: FollowRunsOptions = {},
): Promise<FollowRunsEnd> => {
  /** Each followed tree's runs, by its root, while it is followed. */
  const trees = new Map<string, Set<string>>();
  const followers = new Set<Promise<unknown>>();
  /** Each run's last event passed on: a run followed again starts after it. */
  const seqs = new Map<string, number>();
  const workflows = new Map<string, string>();
  const failure: { error?: unknown } = {};
  /** Ends every follower once one has failed. */
  const halt = new AbortController();
  const signal =
    options.signal === undefined
      ? halt.signal
      : AbortSignal.any([options.signal, halt.signal]);
  /** One hold over every tree, so all runs' events come in store order. */
  const order = createOrdered(onEvent, options.intervalMs ?? 250, error => {
    failure.error ??= error;
    halt.abort();
  });
  signal.addEventListener("abort", order.drop, { once: true });
  const { project } = scope;
  const filter = project === undefined || project === "all" ? {} : { project };
  /** What each tree takes: `untilIdle` is the watch's, not a tree's. */
  const { untilIdle, ...poll } = options;

  const followed = (run: string): boolean =>
    [...trees.values()].some(runs => runs.has(run));
  const workflowOf = (run: string): string => {
    const known = workflows.get(run);
    if (known !== undefined) return known;
    const name = store.lookup(run).find(r => r.id === run)?.workflow ?? "";
    workflows.set(run, name);
    return name;
  };
  const inScope = (run: RunRecord): boolean =>
    (scope.run === undefined || run.id === scope.run) &&
    (scope.workflow === undefined || run.workflow === scope.workflow);

  const adopt = (root: string): void => {
    const runs = new Set([root]);
    trees.set(root, runs);
    const following = followRunTree(
      store,
      root,
      event => {
        runs.add(event.run);
        if (event.stored.seq <= (seqs.get(event.run) ?? 0)) return;
        seqs.set(event.run, event.stored.seq);
        if (signal.aborted) return;
        const { at, seq } = event.stored;
        order.push(
          { ...event, workflow: workflowOf(event.run) },
          at,
          event.run,
          seq,
        );
      },
      { ...poll, signal },
    )
      .catch((error: unknown) => {
        failure.error ??= error;
        halt.abort();
      })
      .finally(() => {
        trees.delete(root);
        followers.delete(following);
      });
    followers.add(following);
  };

  /** Starts a tree for each live run in scope that no tree reaches. */
  const discover = (): void => {
    const live = store
      .runs(filter)
      .filter(run => liveStatus(run) === "running" && inScope(run));
    for (const run of live) workflows.set(run.id, run.workflow);
    const unseen = live.filter(run => !followed(run.id));
    const pending = new Set(unseen.map(run => run.id));
    for (const run of unseen) {
      const { parent } = run;
      const orphan =
        parent === undefined || (!followed(parent) && !pending.has(parent));
      // A caller adopted in this pass reaches the run through its tree.
      if (scope.run !== undefined || orphan) adopt(run.id);
    }
  };

  const settle = async (): Promise<void> => {
    await Promise.all(followers);
    if ("error" in failure) throw failure.error;
  };

  for (;;) {
    if (signal.aborted) break;
    discover();
    // No tree left means no follower left; a failure aborted `signal` above.
    if (untilIdle === true && trees.size === 0) {
      order.flush();
      if ("error" in failure) throw failure.error;
      return "idle";
    }
    try {
      // oxlint-disable-next-line no-await-in-loop -- the one poll: no socket announces a new run
      await sleep(options.intervalMs ?? 1000, undefined, { signal });
    } catch {
      break;
    }
  }
  // A failed follower ended the others: its error, else the caller's abort.
  await settle();
  return "aborted";
};
