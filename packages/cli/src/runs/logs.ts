/**
 * @file `ork logs`: replays a stored run's events as the transcript `ork run`
 *   printed, for the whole run or one node, and tails a live run until it
 *   ends.
 */

import {
  type EventStore,
  followEvents,
  isNodeEvent,
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
    if (options.node !== undefined && !isNodeEvent(event, options.node))
      return [];
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
  const end = await followEvents(
    store,
    run.id,
    stored => {
      for (const line of print(stored)) out(line);
    },
    {
      follow: options.follow,
      ...(options.after === undefined ? {} : { after: options.after }),
      ...(options.intervalMs === undefined
        ? {}
        : { intervalMs: options.intervalMs }),
      ...(options.home === undefined ? {} : { home: options.home }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    },
  );
  if (end === "crashed") {
    out(
      style(
        "red",
        `run ${run.id} stopped without finishing (its process is gone)`,
      ),
    );
  }
};
