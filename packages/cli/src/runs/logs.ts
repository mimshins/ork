/**
 * @file `ork logs`: replays a stored run's events as the transcript `ork run`
 *   printed, for the whole run or one node, and tails a live run until it
 *   ends.
 */

import { setTimeout as sleep } from "node:timers/promises";

import {
  type EventStore,
  liveStatus,
  type RunEvent,
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

const about = (event: RunEvent): string | undefined =>
  "id" in event && typeof event.id === "string" ? event.id : undefined;

/** Turns stored events into lines, keeping the state a transcript needs. */
export const createLogPrinter = (options: LogOptions) => {
  const tools = new Map<string, string>();
  let width = 8;
  return (stored: StoredEvent): string[] => {
    const { event } = stored;
    if (event.type === "run.started") {
      width = Math.max(...event.nodes.map(n => n.id.length), 1);
    }
    if (options.node !== undefined && about(event) !== options.node) return [];
    if (options.json) return [JSON.stringify(stored)];
    return formatRunEvent(event, width, tools);
  };
};

export type FollowOptions = LogOptions & {
  /** Keep printing new events while the run is live. */
  follow: boolean;
  intervalMs?: number;
  signal?: AbortSignal;
};

/**
 * Prints a run's events; with `follow`, then each new one as it is stored,
 * until `run.finished` is stored, the run's process is gone, or `signal`
 * aborts.
 */
export const followRun = async (
  store: EventStore,
  run: RunRecord,
  out: (line: string) => void,
  options: FollowOptions,
): Promise<void> => {
  const print = createLogPrinter(options);
  let seq = 0;
  for (;;) {
    for (const stored of store.events(run.id, seq)) {
      seq = stored.seq;
      for (const line of print(stored)) out(line);
      if (stored.event.type === "run.finished") return;
    }
    if (!options.follow) return;
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
      // oxlint-disable-next-line no-await-in-loop -- polls the store until slice 2's socket
      await sleep(options.intervalMs ?? 250, undefined, {
        signal: options.signal,
      });
    } catch {
      return;
    }
  }
};
