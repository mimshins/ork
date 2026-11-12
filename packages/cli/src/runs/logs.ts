/**
 * @file `ork logs`: replays a stored run's events as the transcript `ork run`
 *   printed, for the whole run or one node, and tails a live run until it
 *   ends.
 */

import {
  applyFilters,
  type EventStore,
  followEvents,
  isNodeEvent,
  type ListFilter,
  type ListTable,
  type RunRecord,
  type StoredEvent,
} from "@krapht/ork-core";

import { style } from "../output.ts";
import { createView, formatRunEvent } from "../run/format.ts";
import type { View } from "../run/view.ts";

export type LogOptions = {
  /** Only this node's events. */
  node?: string;
  /** The stored events as JSON lines. */
  json: boolean;
  /** A failed node's hint and scrubbed detail; on when `node` names one. */
  verbose?: boolean;
  /** How lines are drawn (default: stdout's); `ork attach` narrows its width. */
  view?: View;
};

/** Turns stored events into lines, keeping the state a transcript needs. */
export const createLogPrinter = (options: LogOptions) => {
  const tools = new Map<string, string>();
  const view = options.view ?? createView();
  let width = 8;
  return (stored: StoredEvent): string[] => {
    const { event } = stored;
    if (event.type === "run.started") {
      width = Math.max(...event.nodes.map(n => n.id.length), 1);
    }
    if (options.node !== undefined && !isNodeEvent(event, options.node))
      return [];
    if (options.json) return [JSON.stringify(stored)];
    return formatRunEvent(
      event,
      width,
      tools,
      false,
      options.verbose === true || options.node !== undefined,
      view,
    );
  };
};

/**
 * Why `--node` names nothing in this run, or `null`: no event names it and the
 * run didn't declare it. A live run may still start it, so that is not
 * refused.
 */
export const unknownNode = (
  stored: readonly StoredEvent[],
  node: string,
  live: boolean,
): string | null => {
  const named = stored.some(({ event }) => isNodeEvent(event, node));
  const declared = stored.some(
    ({ event }) =>
      event.type === "run.started" && event.nodes.some(n => n.id === node),
  );
  return named || declared || live ? null : `Run has no node ${node}.`;
};

/** `ork logs`'s filter flags (RFC-017): an event's time; no ids. */
export const logListTable: ListTable<StoredEvent> = {
  fields: [
    {
      name: "since",
      description:
        "Only events since an age (24h, 30d, 12w), a day (2026-11-01), or all",
      type: "since",
      all: true,
      get: stored => stored.at,
    },
    {
      name: "until",
      description: "Only events on or before this day (2026-11-01)",
      type: "until",
      get: stored => stored.at,
    },
  ],
};

export type FollowOptions = LogOptions & {
  /** `--since` and `--until`, checked: only the events they match print. */
  filter?: ListFilter;
  /**
   * Print only the last this many of the stored events (after the filter and
   * `node`); events stored after the replay always print.
   */
  limit?: number;
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
  const matches = (stored: StoredEvent): boolean =>
    applyFilters(logListTable, [stored], options.filter ?? {}).length > 0 &&
    (options.node === undefined || isNodeEvent(stored.event, options.node));
  // The replayed events past the last `limit`; every event still goes through
  // the printer, which keeps the state later lines need.
  const replayed =
    options.limit === undefined
      ? []
      : store
          .events(run.id, options.after ?? 0)
          .filter(stored => matches(stored))
          .slice(0, -options.limit);
  const dropped = new Set(replayed.map(stored => stored.seq));
  const end = await followEvents(
    store,
    run.id,
    stored => {
      const lines = print(stored);
      if (!matches(stored) || dropped.has(stored.seq)) return;
      for (const line of lines) out(line);
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
