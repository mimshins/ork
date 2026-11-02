/**
 * @file Tests for a stream's link: it reports its state, leaves a dropped
 *   connection to the browser, opens a new one with a growing delay when the
 *   browser gives up, and survives a bad frame.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openLink, type LinkStatus } from "../../src/state/stream-link.ts";
import { type FakeSources, openFakeSources } from "../fake-source.ts";

type Events = { tick: { n: number } };

let sources: FakeSources;
let statuses: LinkStatus[];
let ticks: number[];
let at: number;

const link = () =>
  openLink<Events>({
    url: () => `/stream?after=${String(at)}`,
    open: sources.open,
    on: {
      tick: ({ n }) => {
        ticks.push(n);
      },
    },
    onStatus: status => {
      statuses.push(status);
    },
  });

beforeEach(() => {
  vi.useFakeTimers();
  sources = openFakeSources();
  statuses = [];
  ticks = [];
  at = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a stream's link", () => {
  it("reports connecting, open and lost, each once", () => {
    link();
    sources.last().connected();
    sources.last().dropped();
    sources.last().dropped();
    sources.last().connected();
    expect(statuses).toEqual(["connecting", "open", "lost", "open"]);
  });

  it("gives each event's data to its handler", () => {
    link();
    sources.last().send("tick", { n: 7 });
    expect(ticks).toEqual([7]);
  });

  it("drops a frame that is not JSON, and goes on", () => {
    link();
    sources.last().sendText("tick", "{not json");
    sources.last().send("tick", { n: 8 });
    expect(ticks).toEqual([8]);
  });

  it("leaves a dropped connection to the browser", () => {
    link();
    sources.last().dropped();
    vi.advanceTimersByTime(60_000);
    expect(sources.all).toHaveLength(1);
  });

  it("opens a new one when the browser gives up, from the fresh place", () => {
    link();
    at = 42;
    sources.last().refused();
    expect(sources.all).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(sources.all.map(({ url }) => url)).toEqual([
      "/stream?after=0",
      "/stream?after=42",
    ]);
  });

  it("waits longer each time, up to a limit, and less after a success", () => {
    link();
    sources.last().refused();
    vi.advanceTimersByTime(1000);
    sources.last().refused();
    vi.advanceTimersByTime(1999);
    expect(sources.all).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(sources.all).toHaveLength(3);
    sources.last().connected();
    sources.last().refused();
    vi.advanceTimersByTime(1000);
    expect(sources.all).toHaveLength(4);
  });

  it("stays closed once closed, even with a retry waiting", () => {
    const opened = link();
    const first = sources.last();
    first.refused();
    opened.close();
    vi.advanceTimersByTime(60_000);
    expect(sources.all).toHaveLength(1);
    expect(first.closed).toBe(true);
  });
});
