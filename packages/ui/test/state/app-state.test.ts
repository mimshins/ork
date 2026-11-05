/**
 * @file Tests for the page's state: the overview stream fills the containers
 *   and keeps what did not change, the connection says what it knows, a run's
 *   feed is read only while retained, and a resumed run is read again.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createAppState,
  describeConnection,
  liveRuns,
} from "../../src/state/app-state.ts";
import { type FakeSources, openFakeSources } from "../fake-source.ts";
import { fakeServer, runView, span } from "./fixtures.ts";

let sources: FakeSources;

const openState = (events = span(1, 3)) => {
  const { server, client } = fakeServer(events);
  const state = createAppState({
    client,
    open: sources.open,
    storage: localStorage,
  });
  return { server, state };
};

/** The streams opened for runs, not the overview. */
const runStreams = () =>
  sources.all.filter(({ url }) => url.startsWith("/api/runs/"));

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  sources = openFakeSources();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the page's state", () => {
  it("fills runs and decisions from the overview stream", () => {
    const { state } = openState();
    state.start();
    const source = sources.last();
    expect(source.url).toBe("/api/stream");
    expect(state.runs.getValue()).toBeNull();
    source.send("runs", [runView("a")]);
    expect(state.runs.getValue()).toEqual([runView("a")]);
    source.send("decisions", []);
    expect(state.decisions.getValue()).toEqual([]);
  });

  it("keeps the object of a run that did not change", () => {
    const { state } = openState();
    state.start();
    sources.last().send("runs", [runView("a"), runView("b")]);
    const before = state.runs.getValue();
    sources.last().send("runs", [runView("a"), runView("b", "paused")]);
    const after = state.runs.getValue();
    expect(after?.[0]).toBe(before?.[0]);
    expect(after?.[1]).not.toBe(before?.[1]);
  });

  it("does not change at all for a list with nothing new", () => {
    const { state } = openState();
    state.start();
    sources.last().send("runs", [runView("a")]);
    const changes = vi.fn<() => void>();
    state.runs.subscribe(changes);
    sources.last().send("runs", [runView("a")]);
    expect(changes).not.toHaveBeenCalled();
  });

  it("asks the server who it is on each change of the link", async () => {
    const { state, server } = openState();
    state.start();
    sources.last().connected();
    await vi.advanceTimersByTimeAsync(0);
    expect(describeConnection(state.connection.getValue())).toBe("Ork 0.3.0");
    server.failing = 401;
    sources.last().refused();
    await vi.advanceTimersByTimeAsync(0);
    expect(describeConnection(state.connection.getValue())).toBe(
      "Cannot reach `ork ui`: Refused: 401.",
    );
    server.failing = null;
    server.version = "0.4.0";
    await vi.advanceTimersByTimeAsync(1000);
    sources.last().connected();
    await vi.advanceTimersByTimeAsync(0);
    expect(describeConnection(state.connection.getValue())).toBe("Ork 0.4.0");
  });

  it("says the newest reason, though the link stays lost", async () => {
    const { state, server } = openState();
    state.start();
    sources.last().connected();
    server.failing = 500;
    sources.last().refused();
    await vi.advanceTimersByTimeAsync(1000);
    server.failing = 401;
    sources.last().refused();
    await vi.advanceTimersByTimeAsync(0);
    expect(describeConnection(state.connection.getValue())).toBe(
      "Cannot reach `ork ui`: Refused: 401.",
    );
  });

  it("closes the overview stream when stopped", () => {
    const { state } = openState();
    const stop = state.start();
    stop();
    expect(sources.last().closed).toBe(true);
  });

  it("clears the node when another run is selected", () => {
    const { state } = openState();
    state.selectRun("a");
    state.selectNode("build");
    expect(state.selection.getValue()).toEqual({ run: "a", node: "build" });
    state.selectRun("b");
    expect(state.selection.getValue()).toEqual({ run: "b", node: null });
  });

  it("counts the runs that are live", () => {
    expect(liveRuns(null)).toBeNull();
    expect(
      liveRuns([
        runView("a"),
        runView("b", "paused"),
        runView("c", "crashed"),
        runView("d", "succeeded"),
      ]),
    ).toBe(2);
  });
});

describe("a run's feed in the page's state", () => {
  it("reads a run while retained, once however many retain it", async () => {
    const { state } = openState();
    const first = state.retainRun("run");
    const second = state.retainRun("run");
    await vi.advanceTimersByTimeAsync(0);
    expect(runStreams()).toHaveLength(1);
    first();
    expect(runStreams()[0]?.closed).toBe(false);
    second();
    expect(runStreams()[0]?.closed).toBe(true);
  });

  it("keeps a recent feed's events, and forgets the older ones", async () => {
    const { state } = openState();
    const feed = state.feedOf("run");
    const release = state.retainRun("run");
    await vi.advanceTimersByTimeAsync(0);
    release();
    expect(state.feedOf("run")).toBe(feed);
    for (const id of ["a", "b", "c", "d"]) state.retainRun(id)();
    expect(state.feedOf("run")).not.toBe(feed);
  });

  it("reads a resumed run again after its stream ended", async () => {
    const { state } = openState();
    state.start();
    const overview = sources.last();
    state.retainRun("run");
    await vi.advanceTimersByTimeAsync(0);
    const stream = sources.last();
    stream.send("end", { reason: "crashed" });
    overview.send("runs", [runView("run", "crashed")]);
    expect(runStreams()).toHaveLength(1);
    overview.send("runs", [runView("run", "running")]);
    await vi.advanceTimersByTimeAsync(0);
    expect(runStreams()).toHaveLength(2);
    expect(sources.last().url).toBe("/api/runs/run/stream?after=3");
  });
});
