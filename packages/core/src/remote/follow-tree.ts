/**
 * @file Following a run and every run it called, at any depth (`ork attach`, a
 *   foreground caller): each run's events through `followEvents`, a called run
 *   found by the `call.started` that started it, stored or live.
 */

import type { EventStore, StoredEvent } from "../store/types.ts";
import { liveStatus } from "../store/view.ts";
import { type FollowEnd, followEvents } from "./follow.ts";

export type TreeEvent = {
  /** The run that stored the event. */
  run: string;
  /** The call node ids from the root to this run: `[]` for the root. */
  path: readonly string[];
  stored: StoredEvent;
};

export type FollowRunTreeOptions = {
  /** How often to poll a run that has no socket (default 250 ms). */
  intervalMs?: number;
  /** `~`, for the runs' sockets; tests pass a folder. */
  home?: string;
  signal?: AbortSignal;
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
 * started it; live events as they arrive. Ends when the root ends or `signal`
 * aborts.
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
  /** Ends the called runs' following once the root's has ended. */
  const halt = new AbortController();
  const signal =
    options.signal === undefined
      ? halt.signal
      : AbortSignal.any([options.signal, halt.signal]);

  const handle =
    (run: string, path: readonly string[]) =>
    (stored: StoredEvent): void => {
      seqs.set(run, stored.seq);
      onEvent({ run, path, stored });
      const { event } = stored;
      if (event.type === "call.started" && !paths.has(event.run)) {
        follow(event.run, [...path, event.node]);
      }
    };
  const follow = (run: string, path: readonly string[]): void => {
    paths.set(run, path);
    followers.push(
      followEvents(store, run, handle(run, path), {
        ...options,
        follow: true,
        after: seqs.get(run) ?? 0,
        signal,
      }),
    );
  };
  /** Waits for every follower, including those started while waiting. */
  const settle = async (): Promise<void> => {
    while (followers.length > 0) {
      // oxlint-disable-next-line no-await-in-loop -- a follower may find more runs
      await Promise.all(followers.splice(0));
    }
  };

  const end = await followEvents(store, root, handle(root, []), {
    ...options,
    follow: true,
  });
  halt.abort();
  await settle();
  // What the called runs stored before the root ended but their following had
  // not yet read: a halted follower drains the store once and returns.
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
  const stillRunning = [...paths.keys()].slice(1).filter(id => {
    const [run] = store.lookup(id);
    return run !== undefined && liveStatus(run) === "running";
  });
  return { end, stillRunning };
};
