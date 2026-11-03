/**
 * @file Tests for a run's feed: the newest page and then the stream from there,
 *   frames written together, a reconnect that loses nothing, the stream's end,
 *   paging, holding and following again.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PAGE_SIZE } from "../../src/state/event-window.ts";
import { createRunFeed, FLUSH_MS } from "../../src/state/run-feed.ts";
import { type FakeSources, openFakeSources } from "../fake-source.ts";
import { fakeServer, seqsOf, span } from "./fixtures.ts";

let sources: FakeSources;

const started = async (events = span(1, 3)) => {
  const { server, client } = fakeServer(events);
  const feed = createRunFeed({ runId: "run", client, open: sources.open });
  feed.start();
  await vi.advanceTimersByTimeAsync(0);
  return { server, feed, seqs: () => seqsOf(feed.state.getValue().events) };
};

const sendAll = (first: number, last: number) => {
  for (const stored of span(first, last)) {
    sources.last().send("run-event", stored);
  }
};

beforeEach(() => {
  vi.useFakeTimers();
  sources = openFakeSources();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a run's feed", () => {
  it("reads the newest page, then streams after it", async () => {
    const { server, seqs } = await started(span(1, PAGE_SIZE + 10));
    expect(server.asked).toEqual([
      `/api/runs/run/events?last=${String(PAGE_SIZE)}`,
    ]);
    expect(seqs()[0]).toBe(11);
    expect(sources.last().url).toBe(
      `/api/runs/run/stream?after=${String(PAGE_SIZE + 10)}`,
    );
  });

  it("writes a burst of frames as one change", async () => {
    const { feed, seqs } = await started();
    const changes = vi.fn<() => void>();
    feed.state.subscribe(changes);
    sendAll(4, 103);
    expect(changes).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(FLUSH_MS);
    expect(changes).toHaveBeenCalledOnce();
    expect(seqs()).toHaveLength(103);
  });

  it("is live once its stream opens", async () => {
    const { feed } = await started();
    sources.last().connected();
    expect(feed.state.getValue().link).toBe("live");
    sources.last().dropped();
    expect(feed.state.getValue().link).toBe("lost");
  });

  it("drops a frame it has already seen, as after a reconnect", async () => {
    const { seqs } = await started();
    sendAll(2, 5);
    sendAll(4, 6);
    await vi.advanceTimersByTimeAsync(FLUSH_MS);
    expect(seqs()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("starts a new stream after the last frame seen, even one not written", async () => {
    await started();
    sendAll(4, 9);
    sources.last().refused();
    await vi.advanceTimersByTimeAsync(1000);
    expect(sources.last().url).toBe("/api/runs/run/stream?after=9");
  });

  it("writes what it has when the stream ends, and closes it", async () => {
    const { feed, seqs } = await started();
    const source = sources.last();
    sendAll(4, 4);
    source.send("end", { reason: "finished" });
    expect(seqs()).toEqual([1, 2, 3, 4]);
    expect(feed.state.getValue()).toMatchObject({
      link: "ended",
      ended: "finished",
    });
    expect(source.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sources.all).toHaveLength(1);
  });

  it("starts again after an end, from where it was", async () => {
    const { feed, server } = await started();
    sources.last().send("end", { reason: "crashed" });
    feed.start();
    expect(sources.last().url).toBe("/api/runs/run/stream?after=3");
    expect(feed.state.getValue().ended).toBeNull();
    expect(server.asked).toHaveLength(1);
  });

  it("does not open a second stream when started twice", async () => {
    const { feed } = await started();
    feed.start();
    expect(sources.all).toHaveLength(1);
  });

  it("closes its stream on stop, and picks up after it on start", async () => {
    const { feed } = await started();
    const first = sources.last();
    feed.stop();
    expect(first.closed).toBe(true);
    expect(feed.state.getValue().link).toBe("idle");
    feed.start();
    expect(sources.last().url).toBe("/api/runs/run/stream?after=3");
  });

  it("reads again when the first read fails, with the reason shown", async () => {
    const { client, server } = fakeServer(span(1, 3));
    server.failing = 500;
    const feed = createRunFeed({ runId: "run", client, open: sources.open });
    feed.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(feed.state.getValue()).toMatchObject({
      link: "lost",
      error: "Refused: 500.",
    });
    expect(sources.all).toHaveLength(0);
    server.failing = null;
    await vi.advanceTimersByTimeAsync(1000);
    expect(feed.state.getValue().error).toBeNull();
    expect(sources.all).toHaveLength(1);
  });

  it("stops reading again once stopped", async () => {
    const { client, server } = fakeServer();
    server.failing = 500;
    const feed = createRunFeed({ runId: "run", client, open: sources.open });
    feed.start();
    await vi.advanceTimersByTimeAsync(0);
    feed.stop();
    server.failing = null;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sources.all).toHaveLength(0);
  });

  it("pages back to the start of the run", async () => {
    const { feed, seqs } = await started(span(1, PAGE_SIZE + 20));
    await feed.loadOlder();
    expect(seqs()).toEqual(seqsOf(span(1, PAGE_SIZE + 20)));
    expect(feed.state.getValue().paging).toBe(false);
  });

  it("keeps the window when a page fails, and says why", async () => {
    const { feed, seqs, server } = await started(span(1, PAGE_SIZE + 20));
    server.failing = 500;
    await feed.loadOlder();
    expect(seqs()).toHaveLength(PAGE_SIZE);
    expect(feed.state.getValue()).toMatchObject({
      error: "Refused: 500.",
      paging: false,
    });
  });

  it("holds still while held, then pages forward through what came", async () => {
    const { feed, server, seqs } = await started();
    feed.hold();
    server.events = span(1, 6);
    sendAll(4, 6);
    await vi.advanceTimersByTimeAsync(FLUSH_MS);
    expect(seqs()).toEqual([1, 2, 3]);
    expect(feed.state.getValue().latest).toBe(6);
    await feed.loadNewer();
    expect(seqs()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("keeps its tail moving while the window holds still", async () => {
    const { feed, seqs } = await started(span(1, 3));
    feed.hold();
    sendAll(4, 5);
    await vi.advanceTimersByTimeAsync(FLUSH_MS);
    expect(seqs()).toEqual([1, 2, 3]);
    expect(seqsOf(feed.state.getValue().tail)).toEqual([1, 2, 3, 4, 5]);
  });

  it("follows again and joins new events", async () => {
    const { feed, server, seqs } = await started();
    feed.hold();
    server.events = span(1, 6);
    sendAll(4, 6);
    await vi.advanceTimersByTimeAsync(FLUSH_MS);
    await feed.follow();
    expect(seqs()).toEqual([1, 2, 3, 4, 5, 6]);
    server.events = span(1, 7);
    sendAll(7, 7);
    await vi.advanceTimersByTimeAsync(FLUSH_MS);
    expect(seqs().at(-1)).toBe(7);
    expect(feed.state.getValue().following).toBe(true);
  });

  it("catches up on frames that came while a page was read", async () => {
    const { feed, server, seqs } = await started();
    feed.hold();
    server.events = span(1, 6);
    sendAll(4, 6);
    await vi.advanceTimersByTimeAsync(FLUSH_MS);
    const following = feed.follow();
    server.events = span(1, 8);
    sendAll(7, 8);
    await vi.advanceTimersByTimeAsync(FLUSH_MS);
    await following;
    await vi.advanceTimersByTimeAsync(0);
    expect(seqs().at(-1)).toBe(8);
  });
});
