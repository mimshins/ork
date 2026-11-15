/**
 * @file Tests for following many runs (`followRuns`): live roots at start, a
 *   run that starts later, a called run seen once (and again only for what it
 *   stores after its caller ended), `untilIdle`, an abort, and the scope's run,
 *   workflow and project.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type EventStore,
  followRuns,
  type FollowRunsScope,
  openStore,
  type RunEvent,
  type RunsEvent,
} from "../src/index.ts";
import type { StoredEvent } from "../src/store/types.ts";

const started = (runId: string, workflow: string): RunEvent => ({
  type: "run.started",
  runId,
  workflow,
  entries: [],
  nodes: [],
});

const finished = (runId: string): RunEvent => ({
  type: "run.finished",
  result: {
    runId,
    status: "succeeded",
    costUsd: 0,
    nodes: [],
    reasons: [],
    worktrees: [],
  },
});

const called = (node: string, run: string, workflow: string): RunEvent => ({
  type: "call.started",
  node,
  run,
  workflow,
  project: "/p",
});

const nodeStarted = (id: string): RunEvent => ({
  type: "node.started",
  id,
  nodeType: "agent.worker",
  round: 1,
});

/** The store, but reading `failing`'s events throws `error`. */
const failingOn = (
  base: EventStore,
  failing: string,
  error: Error,
): EventStore => ({
  ...base,
  events: (run, after) => {
    if (run === failing) throw error;
    return base.events(run, after);
  },
});

/** The project the tests' runs start in. */
const here: FollowRunsScope = { project: "/p" };

/** The time a stamped event's `at` counts from. */
const BASE = Date.UTC(2026, 0, 1);

describe("followRuns", () => {
  let dir: string;
  let store: EventStore;
  /** What was seen, as `run workflow path|type`, in order. */
  let lines: string[];
  let controller: AbortController;
  /** A stamped event's `at`, as ms after `BASE`, by `run:seq`. */
  let stamps: Map<string, number>;

  /** The event as read: with its stamped `at`, if it has one. */
  const stamp = (stored: StoredEvent): StoredEvent => {
    const ms = stamps.get(`${stored.runId}:${stored.seq}`);
    return ms === undefined
      ? stored
      : { ...stored, at: new Date(BASE + ms).toISOString() };
  };
  /** The store as followed: its events carry their stamped `at`. */
  const timed = (): EventStore => ({
    ...store,
    events: (run, after) =>
      store.events(run, after).map(stored => stamp(stored)),
  });
  /** Stores `event` as if at `ms` after `BASE`. */
  const appendAt = (run: string, event: RunEvent, ms: number): void => {
    stamps.set(`${run}:${store.append(run, event).seq}`, ms);
  };
  /** A running run whose `run.started` is stamped at `ms`. */
  const beginAt = (
    id: string,
    workflow: string,
    ms: number,
    more: { parent?: string } = {},
  ): void => {
    store.begin({ id, workflow, file: "f", project: "/p", ...more });
    appendAt(id, started(id, workflow), ms);
  };

  const record = ({ run, workflow, path: at, stored }: RunsEvent): void => {
    const { event } = stored;
    const what = event.type === "node.started" ? `:${event.id}` : "";
    lines.push(`${run} ${workflow} ${at.join(" › ")}|${event.type}${what}`);
  };

  /** A run recorded in this process, so it reads as running until it ends. */
  const begin = (
    id: string,
    workflow: string,
    more: { parent?: string; project?: string } = {},
  ): void => {
    store.begin({ id, workflow, file: "f", project: "/p", ...more });
    store.append(id, started(id, workflow));
  };

  const follow = (
    scope: FollowRunsScope = here,
    untilIdle = false,
    intervalMs = 5,
  ) =>
    followRuns(timed(), scope, record, {
      home: dir,
      intervalMs,
      signal: controller.signal,
      untilIdle,
    });

  /** Waits until `count` lines have been seen. */
  const seen = (count: number) =>
    vi.waitFor(() => {
      expect(lines.length).toBeGreaterThanOrEqual(count);
    });

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ork-follow-runs-"));
    store = openStore(":memory:");
    lines = [];
    controller = new AbortController();
    stamps = new Map();
  });
  afterEach(() => {
    controller.abort();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("follows every live run, stored events first, until aborted", async () => {
    begin("aaaa0000", "start");
    store.append("aaaa0000", nodeStarted("route"));
    begin("bbbb0000", "build");
    begin("done0000", "plan");
    store.append("done0000", finished("done0000"));
    const following = follow();
    await seen(3);
    store.append("bbbb0000", nodeStarted("impl"));
    await seen(4);
    controller.abort();

    await expect(following).resolves.toBe("aborted");
    expect(lines.toSorted()).toEqual([
      "aaaa0000 start |node.started:route",
      "aaaa0000 start |run.started",
      "bbbb0000 build |node.started:impl",
      "bbbb0000 build |run.started",
    ]);
    expect(lines.at(-1)).toBe("bbbb0000 build |node.started:impl");
  });

  it("picks up a run started after following began, from its first event", async () => {
    begin("aaaa0000", "start");
    const following = follow();
    await seen(1);
    begin("cccc0000", "start");
    store.append("cccc0000", nodeStarted("route"));
    await seen(3);
    controller.abort();

    await following;
    expect(lines.slice(1)).toEqual([
      "cccc0000 start |run.started",
      "cccc0000 start |node.started:route",
    ]);
  });

  it("shows a called run once, under its caller's call path", async () => {
    beginAt("aaaa0000", "start", 0);
    beginAt("plan0000", "plan", 20, { parent: "aaaa0000" });
    appendAt("aaaa0000", called("plan", "plan0000", "plan"), 10);
    appendAt("plan0000", nodeStarted("spec"), 30);
    const following = follow();
    await seen(4);
    // Several discovery passes, none of which may follow the called run again.
    await sleep(50);
    controller.abort();

    await following;
    expect(lines).toEqual([
      "aaaa0000 start |run.started",
      "aaaa0000 start |call.started",
      "plan0000 plan plan|run.started",
      "plan0000 plan plan|node.started:spec",
    ]);
  });

  it("follows a called run on after its caller ends, without repeating it", async () => {
    beginAt("aaaa0000", "start", 0);
    beginAt("plan0000", "plan", 20, { parent: "aaaa0000" });
    appendAt("aaaa0000", called("plan", "plan0000", "plan"), 10);
    const following = follow({ project: "/p" }, true);
    await seen(3);
    store.append("aaaa0000", finished("aaaa0000"));
    await seen(4);
    store.append("plan0000", nodeStarted("spec"));
    await seen(5);
    store.append("plan0000", finished("plan0000"));

    await expect(following).resolves.toBe("idle");
    expect(lines).toEqual([
      "aaaa0000 start |run.started",
      "aaaa0000 start |call.started",
      "plan0000 plan plan|run.started",
      "aaaa0000 start |run.finished",
      "plan0000 plan |node.started:spec",
      "plan0000 plan |run.finished",
    ]);
  });

  it("ends idle once no live run is left, with untilIdle", async () => {
    begin("aaaa0000", "start");
    const following = follow({ project: "/p" }, true);
    await seen(1);
    store.append("aaaa0000", finished("aaaa0000"));

    await expect(following).resolves.toBe("idle");
    expect(lines).toEqual([
      "aaaa0000 start |run.started",
      "aaaa0000 start |run.finished",
    ]);
  });

  it("ends idle at once with untilIdle and no live run", async () => {
    await expect(follow({ project: "/p" }, true)).resolves.toBe("idle");
    expect(lines).toEqual([]);
  });

  it("follows only the scope's run, called or not", async () => {
    begin("aaaa0000", "start");
    begin("plan0000", "plan", { parent: "aaaa0000" });
    store.append("aaaa0000", called("plan", "plan0000", "plan"));
    const following = follow({ project: "/p", run: "plan0000" }, true);
    await seen(1);
    store.append("plan0000", finished("plan0000"));

    await expect(following).resolves.toBe("idle");
    expect(lines).toEqual([
      "plan0000 plan |run.started",
      "plan0000 plan |run.finished",
    ]);
  });

  it("follows the workflow's runs, a called one as a root when its caller is out of scope", async () => {
    begin("aaaa0000", "start");
    begin("plan0000", "plan", { parent: "aaaa0000" });
    store.append("aaaa0000", called("plan", "plan0000", "plan"));
    begin("bbbb0000", "build");
    const following = follow({ project: "/p", workflow: "plan" });
    await seen(1);
    await sleep(50);
    controller.abort();

    await following;
    expect(lines).toEqual(["plan0000 plan |run.started"]);
  });

  it("follows one project's runs, or every project's with all", async () => {
    begin("aaaa0000", "start");
    begin("qqqq0000", "start", { project: "/q" });
    const one = follow({ project: "/q" });
    await seen(1);
    controller.abort();
    await one;
    expect(lines).toEqual(["qqqq0000 start |run.started"]);

    lines = [];
    controller = new AbortController();
    const all = follow({ project: "all" });
    await seen(2);
    controller.abort();
    await all;
    expect(lines.toSorted()).toEqual([
      "aaaa0000 start |run.started",
      "qqqq0000 start |run.started",
    ]);
  });

  it("delivers two runs' live events in store order, whatever order they arrive in", async () => {
    beginAt("aaaa0000", "start", 0);
    beginAt("bbbb0000", "build", 10);
    const following = follow(here, false, 40);
    await seen(2);
    // A's is stored, so read, first or with B's, but stamped later than B's.
    appendAt("aaaa0000", nodeStarted("late"), 30);
    appendAt("bbbb0000", nodeStarted("early"), 20);
    await seen(4);
    controller.abort();

    await following;
    expect(lines).toEqual([
      "aaaa0000 start |run.started",
      "bbbb0000 build |run.started",
      "bbbb0000 build |node.started:early",
      "aaaa0000 start |node.started:late",
    ]);
  });

  it("breaks a tie on at by run id, then seq", async () => {
    beginAt("bbbb0000", "build", 0);
    appendAt("bbbb0000", nodeStarted("b"), 0);
    beginAt("aaaa0000", "start", 0);
    appendAt("aaaa0000", nodeStarted("a"), 0);
    const following = follow();
    await seen(4);
    controller.abort();

    await following;
    expect(lines).toEqual([
      "aaaa0000 start |run.started",
      "aaaa0000 start |node.started:a",
      "bbbb0000 build |run.started",
      "bbbb0000 build |node.started:b",
    ]);
  });

  it("delivers the stored backlog of several runs sorted, not run by run", async () => {
    beginAt("aaaa0000", "start", 0);
    beginAt("bbbb0000", "build", 10);
    appendAt("aaaa0000", nodeStarted("a"), 20);
    appendAt("bbbb0000", nodeStarted("b"), 30);
    const following = follow();
    await seen(4);
    controller.abort();

    await following;
    expect(lines).toEqual([
      "aaaa0000 start |run.started",
      "bbbb0000 build |run.started",
      "aaaa0000 start |node.started:a",
      "bbbb0000 build |node.started:b",
    ]);
  });

  it("merges a caller's and its called run's events by when they were stored", async () => {
    beginAt("aaaa0000", "start", 0);
    appendAt("aaaa0000", called("plan", "plan0000", "plan"), 10);
    beginAt("plan0000", "plan", 20, { parent: "aaaa0000" });
    appendAt("aaaa0000", nodeStarted("after"), 30);
    appendAt("plan0000", nodeStarted("spec"), 40);
    const following = follow();
    await seen(5);
    controller.abort();

    await following;
    expect(lines).toEqual([
      "aaaa0000 start |run.started",
      "aaaa0000 start |call.started",
      "plan0000 plan plan|run.started",
      "aaaa0000 start |node.started:after",
      "plan0000 plan plan|node.started:spec",
    ]);
  });

  it("delivers what it still holds when it ends idle", async () => {
    beginAt("aaaa0000", "start", 0);
    const following = follow(here, true, 100);
    appendAt("aaaa0000", finished("aaaa0000"), 10);

    // The run's end is still held when no tree is left: only a flush shows it.
    await expect(following).resolves.toBe("idle");
    expect(lines).toEqual([
      "aaaa0000 start |run.started",
      "aaaa0000 start |run.finished",
    ]);
  });

  it("drops what it holds once aborted", async () => {
    beginAt("aaaa0000", "start", 0);
    const following = follow(here, false, 100);
    await sleep(20);
    controller.abort();

    await expect(following).resolves.toBe("aborted");
    await sleep(150);
    expect(lines).toEqual([]);
  });

  it("delivers nothing it holds when a follower fails", async () => {
    beginAt("aaaa0000", "start", 0);
    beginAt("bbbb0000", "build", 10);
    const boom = new Error("boom");
    const failing = failingOn(timed(), "bbbb0000", boom);

    // A's first event is held when B's read throws; both happen at once.
    await expect(
      followRuns(failing, here, record, {
        home: dir,
        intervalMs: 5,
        signal: controller.signal,
      }),
    ).rejects.toBe(boom);
    await sleep(30);
    expect(lines).toEqual([]);
  });

  it("rejects, after halting, when onEvent throws on a held event's release", async () => {
    beginAt("aaaa0000", "start", 0);
    const boom = new Error("boom");

    await expect(
      followRuns(
        timed(),
        here,
        () => {
          throw boom;
        },
        { home: dir, intervalMs: 5, signal: controller.signal },
      ),
    ).rejects.toBe(boom);
  });
});
