/**
 * @file The part of a run's events the page holds: an unbroken stretch of at
 *   most {@link WINDOW_CAP}, oldest first, since a long run has more than a tab
 *   should keep. Seqs count 1, 2, 3 within a run, so a stretch's edges say what
 *   lies beyond it. New events join only while the window follows the newest;
 *   otherwise they only move `latest`, and the page reads them when it wants
 *   them. Pure: the run's feed does the reading.
 */

import type { StoredEvent } from "@krapht/ork-server/client";

/** The most events a window holds. */
export const WINDOW_CAP = 2000;

/** How many events one read asks for. */
export const PAGE_SIZE = 500;

export type EventWindow = {
  /** An unbroken stretch, oldest first. */
  events: readonly StoredEvent[];
  /** The newest seq known to exist, in the window or not. */
  latest: number;
  /** New events join the window; false while someone reads back. */
  following: boolean;
};

export const EMPTY_WINDOW: EventWindow = {
  events: [],
  latest: 0,
  following: true,
};

const firstOf = (window: EventWindow): number => window.events[0]?.seq ?? 1;

export const lastOf = (window: EventWindow): number =>
  window.events.at(-1)?.seq ?? 0;

export const hasOlder = (window: EventWindow): boolean => firstOf(window) > 1;

export const hasNewer = (window: EventWindow): boolean =>
  lastOf(window) < window.latest;

const newest = (events: readonly StoredEvent[]): readonly StoredEvent[] =>
  events.slice(-WINDOW_CAP);

const latestOf = (window: EventWindow, batch: readonly StoredEvent[]): number =>
  Math.max(window.latest, batch.at(-1)?.seq ?? 0);

const after = (
  window: EventWindow,
  batch: readonly StoredEvent[],
): readonly StoredEvent[] => {
  const last = lastOf(window);
  return batch.filter(stored => stored.seq > last);
};

/** Events from the stream, oldest first. */
export const withLive = (
  window: EventWindow,
  batch: readonly StoredEvent[],
): EventWindow => {
  const latest = latestOf(window, batch);
  return window.following && !hasNewer(window)
    ? {
        ...window,
        latest,
        events: newest([...window.events, ...after(window, batch)]),
      }
    : { ...window, latest };
};

/** The newest page replaces the window, which follows again. */
export const withTail = (
  window: EventWindow,
  page: readonly StoredEvent[],
): EventWindow => ({
  events: newest(page),
  latest: latestOf(window, page),
  following: true,
});

/** A page from the edge of the window's newer side. */
export const withNewer = (
  window: EventWindow,
  page: readonly StoredEvent[],
): EventWindow => ({
  ...window,
  latest: latestOf(window, page),
  events: newest([...window.events, ...after(window, page)]),
});

/**
 * A page from before the window. Past the cap the newest events leave, and with
 * them the window stops following.
 */
export const withOlder = (
  window: EventWindow,
  page: readonly StoredEvent[],
): EventWindow => {
  const first = firstOf(window);
  const events = [
    ...page.filter(stored => stored.seq < first),
    ...window.events,
  ].slice(0, WINDOW_CAP);
  const next = { ...window, events };
  return { ...next, following: window.following && !hasNewer(next) };
};

/** The read that brings the older side in: its `after` and `limit`. */
export const olderPage = (
  window: EventWindow,
): { after: number; limit: number } => {
  const before = firstOf(window) - 1;
  const start = Math.max(0, before - PAGE_SIZE);
  return { after: start, limit: before - start };
};
