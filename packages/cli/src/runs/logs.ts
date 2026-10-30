/**
 * @file `ork logs`: replays a stored run's events as the transcript `ork run`
 *   printed, for the whole run or one node, and tails a live run until it
 *   ends.
 */

import { setTimeout as sleep } from "node:timers/promises";

import {
  type EventStore,
  followSocket,
  liveStatus,
  nodeOf,
  socketPath,
  type RunRecord,
  type StoredEvent,
} from "@krapht/ork-core";

import { style } from "../output.ts";
import { formatRunEvent } from "../run/format.ts";

export type LogOptions = {
  /** Only this node's events. */
  node?: string;
  /** The stored events as JSON lines. */
  json: boolean;
};

/** Turns stored events into lines, keeping the state a transcript needs. */
export const createLogPrinter = (options: LogOptions) => {
  const tools = new Map<string, string>();
  let width = 8;
  return (stored: StoredEvent): string[] => {
    const { event } = stored;
    if (event.type === "run.started") {
      width = Math.max(...event.nodes.map(n => n.id.length), 1);
    }
    if (options.node !== undefined && nodeOf(event) !== options.node) return [];
    if (options.json) return [JSON.stringify(stored)];
    return formatRunEvent(event, width, tools);
  };
};

export type FollowOptions = LogOptions & {
  /** Keep printing new events while the run is live. */
  follow: boolean;
  /** How often to poll when the run's socket is not there. */
  intervalMs?: number;
  /** `~`, for the run's socket; tests pass a folder. */
  home?: string;
  /** Only events after this sequence number. */
  after?: number;
  signal?: AbortSignal;
};

/**
 * Prints a run's events; with `follow`, then each new one as it is stored:
 * pushed over the run's socket, or polled from the store when there is none.
 * Returns when `run.finished` is stored, the run's process is gone, or `signal`
 * aborts.
 */
export const followRun = async (
  store: EventStore,
  run: RunRecord,
  out: (line: string) => void,
  options: FollowOptions,
): Promise<void> => {
  const print = createLogPrinter(options);
  /** Prints what the run's socket pushes after `after`, until it closes. */
  const viaSocket = async (after: number) => {
    let last = after;
    let finished = false;
    const via = await followSocket(
      socketPath(run.id, options.home),
      after,
      stored => {
        if (stored.seq <= last) return;
        last = stored.seq;
        for (const line of print(stored)) out(line);
        if (stored.event.type === "run.finished") finished = true;
      },
      options.signal,
    );
    return { via, seq: last, finished };
  };
  let seq = options.after ?? 0;
  for (;;) {
    // Chats with a finished run's nodes come after `run.finished`.
    let finished = false;
    for (const stored of store.events(run.id, seq)) {
      seq = stored.seq;
      for (const line of print(stored)) out(line);
      finished ||= stored.event.type === "run.finished";
    }
    if (finished || !options.follow) return;
    // oxlint-disable-next-line no-await-in-loop -- the socket, once; then the store catches up
    const pushed = await viaSocket(seq);
    seq = pushed.seq;
    if (pushed.finished || options.signal?.aborted === true) return;
    const { via } = pushed;
    if (via === "ended") continue;
    const [now] = store.lookup(run.id);
    if (now === undefined || liveStatus(now) !== "running") {
      if (now !== undefined && liveStatus(now) === "crashed") {
        out(
          style(
            "red",
            `run ${run.id} stopped without finishing (its process is gone)`,
          ),
        );
      }
      return;
    }
    try {
      // oxlint-disable-next-line no-await-in-loop -- polls when the run has no socket
      await sleep(options.intervalMs ?? 250, undefined, {
        signal: options.signal,
      });
    } catch {
      return;
    }
  }
};
