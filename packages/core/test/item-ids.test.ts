/**
 * @file Tests that an item of a fanned node (`build.2`, RFC-013) is read as an
 *   instance of its node everywhere an id is read: the store's views, the
 *   activity fold, a node's session, the commands that name a node, a stop's
 *   reach, the clock's owners and the workspace. A declared id has no `.`, so
 *   an item's id never collides with one.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseWorkflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import {
  activeTree,
  compileWorkflow,
  createWorkspace,
  nodeSession,
  openStore,
  requestPause,
  requestStop,
  type RunEvent,
  runTree,
  templateOf,
} from "../src/index.ts";
import { createHolds, createStops } from "../src/run/holds.ts";
import { createClock } from "../src/run/timeouts.ts";
import { repo, sh } from "./fixtures/git.ts";

const WORKFLOW = [
  "schemaVersion: 1",
  "name: t",
  "nodes:",
  "  build: { type: claude.worker, prompt: go }",
  "  gate: { type: claude.worker, prompt: after }",
  "edges:",
  "  - from: build",
  "    to: gate",
].join("\n");

const compile = () => {
  const parsed = parseWorkflow(WORKFLOW);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  const { graph } = compileWorkflow(parsed.workflow);
  if (graph === null) throw new Error("does not compile");
  return graph;
};

/** `build` fanned into `build.0` (done) and `build.2` (running). */
const EVENTS: RunEvent[] = [
  {
    type: "run.started",
    runId: "r1",
    workflow: "t",
    entries: ["build"],
    nodes: [
      { id: "build", type: "claude.worker" },
      { id: "gate", type: "claude.worker" },
    ],
  },
  { type: "node.started", id: "build.0", nodeType: "claude.worker", round: 1 },
  {
    type: "node.event",
    id: "build.0",
    event: {
      type: "session.started",
      sessionId: "s0",
      model: "sonnet",
      cwd: "/work/zero",
    },
  },
  {
    type: "node.event",
    id: "build.0",
    event: {
      type: "tool.called",
      id: "t",
      name: "Read",
      input: { file_path: "a.ts" },
    },
  },
  {
    type: "node.finished",
    id: "build.0",
    round: 1,
    ok: true,
    output: { summary: "zero" },
  },
  { type: "node.started", id: "build.2", nodeType: "claude.worker", round: 1 },
];

const STORED = EVENTS.map((event, index) => ({
  runId: "r1",
  seq: index + 1,
  at: "2026-11-08T00:00:00.000Z",
  event,
}));

describe("an item's id", () => {
  it("is an instance of its node, and a spawned worker's still is", () => {
    const declared = new Set(["build", "gate"]);
    expect(templateOf("build.2", declared)).toBe("build");
    expect(templateOf("build-2", declared)).toBe("build");
    expect(templateOf("build.2", new Set(["gate"]))).toBeUndefined();
    expect(templateOf("build", declared)).toBeUndefined();
  });

  it("shows in the run's tree as a node with its template", () => {
    const tree = runTree(EVENTS);
    const items = tree.filter(n => n.template === "build");
    expect(items.map(n => [n.id, n.state])).toEqual([
      ["build.0", "ok"],
      ["build.2", "running"],
    ]);
  });

  it("has its own activity", () => {
    const stored = STORED;
    const zero = activeTree(stored).find(n => n.id === "build.0");
    expect(zero).toMatchObject({ now: "zero", template: "build" });
  });

  it("has its own session, read by its id", () => {
    const stored = STORED;
    expect(nodeSession(stored, "build.0").session).toMatchObject({
      known: true,
      chattable: true,
      running: false,
      sessionId: "s0",
      cwd: "/work/zero",
    });
    expect(nodeSession(stored, "build.2").session.running).toBe(true);
    expect(nodeSession(stored, "build.9").session.known).toBe(false);
  });
});

const live = () => {
  const store = openStore(":memory:");
  const run = store.begin({
    id: "r1",
    workflow: "t",
    file: "/t",
    project: "/p",
  });
  for (const event of EVENTS) store.append("r1", event);
  return { store, run, home: mkdtempSync(path.join(tmpdir(), "ork-item-")) };
};

const quiet = () => {
  // Not under test.
};

describe("a command naming an item", () => {
  it("stops the item, or every item by the node's name", async () => {
    const { store, run, home } = live();
    expect(await requestStop(store, run, home, "build.2")).toMatchObject({
      ok: true,
    });
    expect(await requestStop(store, run, home, "build")).toMatchObject({
      ok: true,
    });
    expect(await requestStop(store, run, home, "build.0")).toEqual({
      ok: false,
      error: "build.0 is not running in run r1.",
    });
    expect(await requestStop(store, run, home, "build.7")).toEqual({
      ok: false,
      error: "build.7 is not a node of run r1.",
    });
  });

  it("pauses the item, which the run's tree has", async () => {
    const { store, run, home } = live();
    expect(await requestPause(store, run, home, "build.2")).toMatchObject({
      ok: true,
    });
  });
});

describe("a stop and a hold", () => {
  it("reach one item by its id, or every item by the node's", () => {
    const stops = createStops(new AbortController().signal);
    const two = stops.signalFor("build.2", "build");
    const three = stops.signalFor("build.3", "build");
    expect(stops.stop("build.2")).toBe(true);
    expect([two.aborted, three.aborted]).toEqual([true, false]);
    expect(stops.stop("build")).toBe(true);
    expect(three.aborted).toBe(true);
    expect(stops.ended("build.2", { ok: true, output: {} }).ok).toBe(false);
  });

  it("hold an item when its node, or it, is paused", () => {
    const holds = createHolds({
      onEvent: quiet,
      onChange: quiet,
    });
    holds.pause("build");
    expect(holds.isHeld("build.2", "build")).toBe(true);
    holds.proceed("build");
    holds.pause("build.2");
    expect(holds.isHeld("build.2", "build")).toBe(true);
    expect(holds.isHeld("build.3", "build")).toBe(false);
  });

  it("make the clock count an item as its node", () => {
    const graph = compile();
    const holds = createHolds({
      onEvent: quiet,
      onChange: quiet,
    });
    const clock = createClock({ graph, holds, running: new Set() });
    holds.pause("build");
    expect(clock.forNode("build.2").held()).toBe(true);
    expect(clock.forNode("gate").held()).toBe(false);
  });
});

describe("a worktree for an item", () => {
  it("is the node's kind of worktree, named by the item's id", async () => {
    const root = repo();
    const events: RunEvent[] = [];
    const workspace = createWorkspace({
      graph: compile(),
      runId: "r1",
      root,
      head: sh(root, "rev-parse", "HEAD").trim(),
      onEvent: event => {
        events.push(event);
      },
    });
    const { cwd, checkout } = await workspace.prepare("build.2", "build");
    expect(checkout).toMatchObject({ own: true, owner: "build.2" });
    expect(cwd).not.toBe(root);
    expect(path.basename(cwd)).toContain("build.2");
    expect(events).toContainEqual(
      expect.objectContaining({ type: "worktree", id: "build.2" }),
    );
  });
});
