/**
 * @file Following a run's events from another process (`ork logs -f`, the local
 *   server's event stream): the stored events after a sequence number, then
 *   each new one as the run stores it, pushed over the run's socket (ADR-024),
 *   or polled from the store when there is no socket.
 */

import { setTimeout as sleep } from "node:timers/promises";

import { followSocket, socketPath } from "../control/socket.ts";
import type { EventStore, StoredEvent } from "../store/types.ts";
import { liveStatus } from "../store/view.ts";

export type FollowEventsOptions = {
  /** Keep going while the run is live (default: only the stored events). */
  follow: boolean;
  /** Only events after this sequence number. */
  after?: number;
  /** How often to poll when the run has no socket (default 250 ms). */
  intervalMs?: number;
  /** `~`, for the run's socket; tests pass a folder. */
  home?: string;
  signal?: AbortSignal;
};

/**
 * Why following stopped: `run.finished` was stored; the run is no longer
 * running without it (`crashed`: its process is gone; `ended`: it is stopped
 * otherwise); `signal` aborted; or `stored` when not following.
 */
export type FollowEnd = "finished" | "crashed" | "ended" | "aborted" | "stored";

/** Calls `onEvent` for each event of the run in order, once each. */
export const followEvents = async (
  store: EventStore,
  runId: string,
  onEvent: (stored: StoredEvent) => void,
  options: FollowEventsOptions,
): Promise<FollowEnd> => {
  // Changed from the callbacks, so not narrowed by the checks below.
  const seen = { seq: options.after ?? 0, finished: false };
  // Ends the socket follow once the run has finished, rather than waiting for
  // the run's process to close its socket.
  const done = new AbortController();
  const emit = (stored: StoredEvent): void => {
    if (stored.seq <= seen.seq) return;
    seen.seq = stored.seq;
    onEvent(stored);
    if (stored.event.type === "run.finished") {
      seen.finished = true;
      done.abort();
    }
  };
  const aborted = (): boolean => options.signal?.aborted === true;
  /** Takes what the store has; true once `run.finished` is among it. */
  const drain = (): boolean => {
    for (const stored of store.events(runId, seen.seq)) emit(stored);
    return seen.finished;
  };
  for (;;) {
    // Chats with a finished run's nodes come after `run.finished`.
    if (drain()) return "finished";
    if (!options.follow) return "stored";
    if (aborted()) return "aborted";
    // oxlint-disable-next-line no-await-in-loop -- the socket, once; then the store catches up
    const via = await followSocket(
      socketPath(runId, options.home),
      seen.seq,
      emit,
      options.signal === undefined
        ? done.signal
        : AbortSignal.any([options.signal, done.signal]),
    );
    if (seen.finished) return "finished";
    if (aborted()) return "aborted";
    if (via === "ended") continue;
    const [now] = store.lookup(runId);
    const status = now === undefined ? "ended" : liveStatus(now);
    if (status !== "running") {
      // What the run stored between the last read and now.
      if (drain()) return "finished";
      return status === "crashed" ? "crashed" : "ended";
    }
    try {
      // oxlint-disable-next-line no-await-in-loop -- polls when the run has no socket
      await sleep(options.intervalMs ?? 250, undefined, {
        signal: options.signal,
      });
    } catch {
      return "aborted";
    }
  }
};
