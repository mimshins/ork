/**
 * @file Following a run and every run it called, at any depth (`ork attach`, a
 *   foreground caller): each run's events through `followEvents`, a called run
 *   found by the `call.started` that started it, stored or live, and followed
 *   again when a resumed caller brings it back after it ended.
 */

import { setTimeout as sleep } from "node:timers/promises";

import type { EventStore, StoredEvent } from "../store/types.ts";
import { liveStatus } from "../store/view.ts";
import { type FollowEnd, followEvents } from "./follow.ts";
import { createOrdered } from "./order-events.ts";

export type TreeEvent = {
  /** The run that stored the event. */
  run: string;
  /** The call node ids from the root to this run: `[]` for the root. */
  path: readonly string[];
  stored: StoredEvent;
};

export type FollowRunTreeOptions = {
  /**
   * Keep going while the root is live (default true); false replays what the
   * runs have stored and returns (`ork logs <run>`).
   */
  follow?: boolean;
  /** How often to poll a run that has no socket (default 250 ms). */
  intervalMs?: number;
  /** `~`, for the runs' sockets; tests pass a folder. */
  home?: string;
  signal?: AbortSignal;
  /**
   * Hold each event `intervalMs` (default 250 ms) and deliver the runs' events
   * in store order, `(at, run, seq)` (default false). With it, a called run's
   * stored events are no longer grouped after their `call.started`.
   */
  ordered?: boolean;
};

export type FollowTreeEnd = {
  /** Why following the root stopped. */
  end: FollowEnd;
  /** The called runs, at any depth, still running when it stopped. */
  stillRunning: string[];
};

/**
 * Calls `onEvent` for each event of `root` and of the runs it called, once
 * each. A called run's stored events come right after the `call.started` that
 * started it; live events as they arrive; with `ordered`, all in store order.
 * Ends when the root ends or `signal` aborts; with `follow: false`, once the
 * stored events are read. Events still held then are delivered, unless `signal`
 * aborted or following failed.
 */
export const followRunTree = async (
  store: EventStore,
  root: string,
  onEvent: (event: TreeEvent) => void,
  options: FollowRunTreeOptions = {},
): Promise<FollowTreeEnd> => {
  /** Every run followed, with its call path, in the order found. */
  const paths = new Map<string, readonly string[]>([[root, []]]);
  /** Each run's last event seen, for the catch-up once the root ends. */
  const seqs = new Map<string, number>();
  const followers: Promise<FollowEnd>[] = [];
  const live = options.follow ?? true;
  /** Ends the root's following once a held event's delivery has failed. */
  const fail = new AbortController();
  const failure: { error?: unknown } = {};
  const rootSignal =
    options.signal === undefined
      ? fail.signal
      : AbortSignal.any([options.signal, fail.signal]);
  /** Ends the called runs' following once the root's has ended. */
  const halt = new AbortController();
  const signal = AbortSignal.any([rootSignal, halt.signal]);
  const order =
    options.ordered === true
      ? createOrdered(onEvent, options.intervalMs ?? 250, error => {
          failure.error ??= error;
          fail.abort();
        })
      : undefined;
  if (order !== undefined) {
    rootSignal.addEventListener("abort", order.drop, { once: true });
  }
  const deliver = (event: TreeEvent): void => {
    if (order === undefined) onEvent(event);
    else if (!rootSignal.aborted) {
      order.push(event, event.stored.at, event.run, event.stored.seq);
    }
  };

  const handle =
    (run: string, path: readonly string[]) =>
    (stored: StoredEvent): void => {
      seqs.set(run, stored.seq);
      deliver({ run, path, stored });
      const { event } = stored;
      if (event.type === "call.started" && !paths.has(event.run)) {
        follow(event.run, [...path, event.node]);
      }
    };
  /** Whether `run` is running again before the root ends: resumed. */
  const resumedAgain = async (run: string): Promise<boolean> => {
    for (;;) {
      const [now] = store.lookup(run);
      if (now !== undefined && liveStatus(now) === "running") return true;
      try {
        // oxlint-disable-next-line no-await-in-loop -- polls the run's status until the root ends
        await sleep(options.intervalMs ?? 250, undefined, { signal });
      } catch {
        return false;
      }
    }
  };
  /**
   * Follows a called run to its end, and again each time it is resumed while
   * the root runs on: a resumed caller brings it back under its id with no new
   * `call.started`.
   */
  const followCalled = async (
    run: string,
    path: readonly string[],
  ): Promise<FollowEnd> => {
    for (;;) {
      // oxlint-disable-next-line no-await-in-loop -- one go of the run, then the next
      const end = await followEvents(store, run, handle(run, path), {
        ...options,
        follow: live,
        after: seqs.get(run) ?? 0,
        signal,
      });
      // oxlint-disable-next-line no-await-in-loop -- waits for a resume
      if (!live || end === "aborted" || !(await resumedAgain(run))) return end;
    }
  };
  const follow = (run: string, path: readonly string[]): void => {
    paths.set(run, path);
    followers.push(followCalled(run, path));
  };
  /** Waits for every follower, including those started while waiting. */
  const settle = async (): Promise<void> => {
    while (followers.length > 0) {
      // oxlint-disable-next-line no-await-in-loop -- a follower may find more runs
      await Promise.all(followers.splice(0));
    }
  };

  const followAll = async (): Promise<FollowEnd> => {
    const end = await followEvents(store, root, handle(root, []), {
      ...options,
      follow: live,
      signal: rootSignal,
    });
    halt.abort();
    await settle();
    // What the called runs stored before the root ended but their following
    // had not yet read: a halted follower drains the store once and returns.
    if (end !== "aborted") {
      for (const [run, path] of [...paths].slice(1)) {
        followers.push(
          followEvents(store, run, handle(run, path), {
            follow: false,
            after: seqs.get(run) ?? 0,
          }),
        );
      }
      await settle();
    }
    return end;
  };
  const end = await followAll().catch((error: unknown) => {
    order?.drop();
    throw error;
  });
  if (end === "aborted") order?.drop();
  else order?.flush();
  if ("error" in failure) throw failure.error;
  const stillRunning = [...paths.keys()].slice(1).filter(id => {
    const [run] = store.lookup(id);
    return run !== undefined && liveStatus(run) === "running";
  });
  return { end, stillRunning };
};
