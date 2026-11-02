/**
 * @file Tests for the event window: it stays capped and unbroken, joins live
 *   events only while following at the newest, and pages both ways.
 */

import { describe, expect, it } from "vitest";

import {
  EMPTY_WINDOW,
  type EventWindow,
  hasNewer,
  hasOlder,
  olderPage,
  PAGE_SIZE,
  WINDOW_CAP,
  withLive,
  withNewer,
  withOlder,
  withTail,
} from "../../src/state/event-window.ts";
import { seqsOf, span } from "./fixtures.ts";

const ending = (last: number, length: number): EventWindow =>
  withTail(EMPTY_WINDOW, span(last - length + 1, last));

const edges = ({ events }: EventWindow) => {
  const seqs = seqsOf(events);
  return [seqs[0], seqs.at(-1), seqs.length];
};

describe("the event window", () => {
  it("joins live events while following at the newest", () => {
    const window = withLive(ending(3, 3), span(4, 5));
    expect(seqsOf(window.events)).toEqual([1, 2, 3, 4, 5]);
    expect(window.latest).toBe(5);
  });

  it("starts empty and takes the first events", () => {
    expect(seqsOf(withLive(EMPTY_WINDOW, span(1, 2)).events)).toEqual([1, 2]);
  });

  it("ignores what it already holds", () => {
    expect(seqsOf(withLive(ending(3, 3), span(2, 4)).events)).toEqual([
      1, 2, 3, 4,
    ]);
  });

  it("drops the oldest past the cap, and knows older ones exist", () => {
    const window = withLive(
      ending(WINDOW_CAP, WINDOW_CAP),
      span(WINDOW_CAP + 1, WINDOW_CAP + 10),
    );
    expect(edges(window)).toEqual([11, WINDOW_CAP + 10, WINDOW_CAP]);
    expect(hasOlder(window)).toBe(true);
  });

  it("holds still while not following, and only learns the latest", () => {
    const held = { ...ending(5, 5), following: false };
    const window = withLive(held, span(6, 8));
    expect(edges(window)).toEqual([1, 5, 5]);
    expect(window.latest).toBe(8);
    expect(hasNewer(window)).toBe(true);
  });

  it("asks for the page before the window, and no further than the start", () => {
    expect(olderPage(ending(1000, 100))).toEqual({
      after: 900 - PAGE_SIZE,
      limit: PAGE_SIZE,
    });
    expect(olderPage(ending(120, 100))).toEqual({ after: 0, limit: 20 });
  });

  it("takes an older page, and has no older side at the start", () => {
    const window = withOlder(ending(120, 100), span(1, 20));
    expect(edges(window)).toEqual([1, 120, 120]);
    expect(hasOlder(window)).toBe(false);
    expect(window.following).toBe(true);
  });

  it("stops following when older pages push the newest out", () => {
    const full = ending(WINDOW_CAP + 500, WINDOW_CAP);
    const window = withOlder(full, span(1, 500));
    expect(edges(window)).toEqual([1, WINDOW_CAP, WINDOW_CAP]);
    expect(window.following).toBe(false);
    expect(hasNewer(window)).toBe(true);
  });

  it("takes a newer page, dropping the oldest past the cap", () => {
    const start = { ...ending(WINDOW_CAP, WINDOW_CAP), latest: WINDOW_CAP + 5 };
    const window = withNewer(start, span(WINDOW_CAP + 1, WINDOW_CAP + 5));
    expect(edges(window)).toEqual([6, WINDOW_CAP + 5, WINDOW_CAP]);
    expect(hasNewer(window)).toBe(false);
  });

  it("follows again from a tail, keeping a newer latest", () => {
    const window = withTail(
      { ...ending(5, 5), latest: 90, following: false },
      span(40, 80),
    );
    expect(window.following).toBe(true);
    expect(window.latest).toBe(90);
    expect(hasNewer(window)).toBe(true);
  });
});
