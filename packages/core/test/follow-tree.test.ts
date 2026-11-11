/**
 * @file Tests for following a run and the runs it called (`followRunTree`):
 *   replay order across a call chain, live events and runs found live, a root
 *   that ends while a called run still runs, an abort, and a run resumed after
 *   it had ended.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type EventStore,
  followRunTree,
  openStore,
  type RunEvent,
  type TreeEvent,
} from "../src/index.ts";

const started = (runId: string): RunEvent => ({
  type: "run.started",
  runId,
  workflow: "w",
  entries: [],
  nodes: [],
});

const finished = (
  runId: string,
  status: "succeeded" | "failed" = "succeeded",
): RunEvent => ({
  type: "run.finished",
  result: {
    runId,
    status,
    costUsd: 0,
    nodes: [],
    reasons: [],
    worktrees: [],
  },
});

const called = (node: string, run: string): RunEvent => ({
  type: "call.started",
  node,
  run,
  workflow: "w",
  project: "/p",
});

const nodeStarted = (id: string): RunEvent => ({
  type: "node.started",
  id,
  nodeType: "claude.worker",
  round: 1,
});

describe("followRunTree", () => {
  let dir: string;
  let store: EventStore;
  /** What was seen, as `path|type` (or `path|type:node`), in order. */
  let lines: string[];

  const record = ({ path: at, stored }: TreeEvent): void => {
    const { event } = stored;
    const what =
      event.type === "node.started" || event.type === "call.started"
        ? `${event.type}:${event.type === "node.started" ? event.id : event.node}`
        : event.type;
    lines.push(`${at.join(" › ")}|${what}`);
  };

  /** A run recorded in this process, so it reads as running until it ends. */
  const begin = (id: string): void => {
    store.begin({ id, workflow: "w", file: "f", project: "/p" });
    store.append(id, started(id));
  };

  const follow = (signal = new AbortController().signal) =>
    followRunTree(store, "root0000", record, {
      home: dir,
      intervalMs: 5,
      signal,
    });

  /** Waits until `count` lines have been seen. */
  const seen = (count: number) =>
    vi.waitFor(() => {
      expect(lines.length).toBeGreaterThanOrEqual(count);
    });

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ork-follow-tree-"));
    store = openStore(":memory:");
    lines = [];
    begin("root0000");
  });
  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("replays a call chain with each called run right after its call", async () => {
    store.append("root0000", called("plan", "plan0000"));
    begin("plan0000");
    store.append("plan0000", called("spec", "spec0000"));
    begin("spec0000");
    store.append("spec0000", finished("spec0000"));
    store.append("plan0000", finished("plan0000"));
    store.append("root0000", finished("root0000"));

    await expect(follow()).resolves.toEqual({
      end: "finished",
      stillRunning: [],
    });
    expect(lines).toEqual([
      "|run.started",
      "|call.started:plan",
      "plan|run.started",
      "plan|call.started:spec",
      "plan › spec|run.started",
      "plan › spec|run.finished",
      "plan|run.finished",
      "|run.finished",
    ]);
  });

  it("gives each event its run and the call path to it", async () => {
    store.append("root0000", called("build", "bld00000"));
    begin("bld00000");
    store.append("bld00000", called("review.1", "rev00000"));
    begin("rev00000");
    store.append("root0000", finished("root0000"));
    const runs: [string, readonly string[]][] = [];

    await followRunTree(
      store,
      "root0000",
      ({ run, path: at }) => {
        runs.push([run, at]);
      },
      { home: dir, intervalMs: 5 },
    );

    expect(runs.at(-2)).toEqual(["rev00000", ["build", "review.1"]]);
  });

  it("follows stored events first, then live ones as they come", async () => {
    store.append("root0000", called("plan", "plan0000"));
    begin("plan0000");
    const following = follow();
    await seen(3);
    store.append("plan0000", nodeStarted("spec"));
    await seen(4);
    store.append("root0000", nodeStarted("after"));
    await seen(5);
    store.append("plan0000", finished("plan0000"));
    await seen(6);
    store.append("root0000", finished("root0000"));

    await expect(following).resolves.toEqual({
      end: "finished",
      stillRunning: [],
    });
    expect(lines).toEqual([
      "|run.started",
      "|call.started:plan",
      "plan|run.started",
      "plan|node.started:spec",
      "|node.started:after",
      "plan|run.finished",
      "|run.finished",
    ]);
  });

  it("follows a run called after following began, from its first event", async () => {
    const following = follow();
    await seen(1);
    begin("plan0000");
    store.append("plan0000", nodeStarted("spec"));
    store.append("root0000", called("plan", "plan0000"));
    await seen(4);
    store.append("plan0000", finished("plan0000"));
    await seen(5);
    store.append("root0000", finished("root0000"));

    await following;
    expect(lines).toEqual([
      "|run.started",
      "|call.started:plan",
      "plan|run.started",
      "plan|node.started:spec",
      "plan|run.finished",
      "|run.finished",
    ]);
  });

  it("reports a called run still running when the root ends", async () => {
    store.append("root0000", called("notify", "ntfy0000"));
    begin("ntfy0000");
    store.append("ntfy0000", nodeStarted("send"));
    store.append("root0000", finished("root0000"));

    await expect(follow()).resolves.toEqual({
      end: "finished",
      stillRunning: ["ntfy0000"],
    });
    expect(lines).toContain("notify|node.started:send");
  });

  it("stops on abort, naming the called runs still running", async () => {
    store.append("root0000", called("plan", "plan0000"));
    begin("plan0000");
    const controller = new AbortController();
    const following = follow(controller.signal);
    await seen(3);
    controller.abort();

    await expect(following).resolves.toEqual({
      end: "aborted",
      stillRunning: ["plan0000"],
    });
  });
  /** What `ork resume` leaves: the earlier go's failed end, then a new go. */
  const resumed = (id: string): void => {
    store.append(id, finished(id, "failed"));
    store.reopen(id);
    store.append(id, started(id));
  };

  it("keeps following a run resumed after it ended, to its new end", async () => {
    resumed("root0000");
    const following = follow();
    await seen(3);
    store.append("root0000", nodeStarted("gate"));
    await seen(4);
    store.append("root0000", finished("root0000"));

    await expect(following).resolves.toEqual({
      end: "finished",
      stillRunning: [],
    });
    expect(lines).toEqual([
      "|run.started",
      "|run.finished",
      "|run.started",
      "|node.started:gate",
      "|run.finished",
    ]);
  });

  it("keeps following a called run resumed after it ended", async () => {
    store.append("root0000", called("plan", "plan0000"));
    begin("plan0000");
    resumed("plan0000");
    const following = follow();
    await seen(5);
    store.append("plan0000", nodeStarted("gate"));
    await seen(6);
    store.append("plan0000", finished("plan0000"));
    await seen(7);
    store.append("root0000", finished("root0000"));

    await following;
    expect(lines.slice(5)).toEqual([
      "plan|node.started:gate",
      "plan|run.finished",
      "|run.finished",
    ]);
  });
});
