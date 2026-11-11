/**
 * @file Tests for pause, continue and a node's stop (ADR-041): a paused run
 *   starts nothing new and holds a session at its next tool call; a paused node
 *   is held alone; a stopped node fails "stopped by the user" while the run
 *   goes on; a gate's timer counts only while not held; and the commands travel
 *   through the store, the run's control and its views, with the CLI's
 *   refusals.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { parseWorkflow } from "@krapht/ork-schema";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type CompiledGraph,
  compileWorkflow,
  createHolds,
  heldTimeout,
  type HumanChannel,
  type NodeExecutor,
  openStore,
  pausedOf,
  requestContinue,
  requestPause,
  requestStop,
  type RunEvent,
  runTree,
  startControl,
  startRun,
} from "../src/index.ts";

const compile = (yaml: string): CompiledGraph => {
  const parsed = parseWorkflow(yaml);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  const { graph, diagnostics } = compileWorkflow(parsed.workflow);
  if (graph === null) throw new Error(JSON.stringify(diagnostics));
  return graph;
};

/** Workers `a` and `b`, with `a -> b` when `chained`. */
const twoWorkers = (chained: boolean): CompiledGraph =>
  compile(
    [
      "schemaVersion: 1",
      "name: t",
      "nodes:",
      "  a: { type: agent.worker, prompt: a }",
      "  b: { type: agent.worker, prompt: b }",
      ...(chained ? ["edges:", "  - from: a", "    to: b"] : ["edges: []"]),
    ].join("\n"),
  );

const NO_HUMAN: HumanChannel = {
  permit: () => Promise.resolve({ allow: true }),
  ask: () => Promise.resolve(""),
};

const OK = { ok: true, output: { status: "pass", summary: "ok" } };

/**
 * A session stand-in: each node waits for its "tool call" to be allowed
 * (`tools.get(id)`), passes the hold there, and ends; a stop ends it early.
 */
const sessions = () => {
  const tools = new Map<string, PromiseWithResolvers<void>>();
  const started: string[] = [];
  const call = (id: string) => {
    const existing = tools.get(id);
    if (existing !== undefined) return existing;
    const made = Promise.withResolvers<void>();
    tools.set(id, made);
    return made;
  };
  const executor: NodeExecutor = async context => {
    started.push(context.id);
    const stopped = new Promise<void>(resolve => {
      context.signal.addEventListener("abort", () => {
        resolve();
      });
    });
    await Promise.race([call(context.id).promise, stopped]);
    await context.hold?.wait("tool", context.signal);
    return context.signal.aborted
      ? { ok: false, output: { status: "fail" }, error: "interrupted" }
      : OK;
  };
  return {
    executor,
    started,
    /** Lets `id` make its tool call. */
    call: (id: string) => {
      call(id).resolve();
    },
  };
};

const start = (graph: CompiledGraph, executor: NodeExecutor) => {
  const events: RunEvent[] = [];
  const handle = startRun({
    graph,
    inputs: {},
    cwd: mkdtempSync(path.join(tmpdir(), "ork-hold-")),
    executors: { "agent.worker": executor },
    human: NO_HUMAN,
    onEvent: event => {
      events.push(event);
    },
  });
  const types = () => events.map(e => e.type);
  return { handle, events, types };
};

const tick = () => sleep(20);

/** The nodes that finished, in order. */
const finishedIds = (events: readonly RunEvent[]): string[] =>
  events.flatMap(e => (e.type === "node.finished" ? [e.id] : []));

/** Records what a control asked for, and changes nothing for `b`. */
const recordingControl = (asked: string[]) => ({
  onStop: () => {
    asked.push("stop run");
  },
  onControl: (command: string, node: string | undefined) => {
    asked.push(`${command} ${node ?? "run"}`);
    return node !== "b";
  },
});

describe("pausing a run", () => {
  it("holds a session at its next tool call and starts nothing new until it continues", async () => {
    const { executor, started, call } = sessions();
    const { handle, events, types } = start(twoWorkers(true), executor);
    await tick();
    expect(handle.pause()).toBe(true);
    expect(handle.pause()).toBe(false);
    call("a");
    await tick();
    expect(events).toContainEqual({ type: "node.held", id: "a", at: "tool" });
    expect(types()).not.toContain("node.finished");
    expect(handle.proceed()).toBe(true);
    await tick();
    expect(events).toContainEqual({ type: "node.released", id: "a" });
    expect(started).toEqual(["a", "b"]);
    call("b");
    expect((await handle.done).status).toBe("succeeded");
    expect(handle.proceed()).toBe(false);
  });

  it("does not start a paused node's next activation", async () => {
    const { executor, started, call } = sessions();
    const { handle } = start(twoWorkers(true), executor);
    await tick();
    expect(handle.pause("b")).toBe(true);
    call("a");
    await tick();
    expect(started).toEqual(["a"]);
    handle.proceed("b");
    await tick();
    expect(started).toEqual(["a", "b"]);
    call("b");
    expect((await handle.done).status).toBe("succeeded");
  });
});

/** `c` notes its round and ends; the others are sessions. */
const recordingC =
  (others: NodeExecutor, rounds: [string, number][]): NodeExecutor =>
  context => {
    if (context.id !== "c") return others(context);
    rounds.push([context.id, context.round]);
    return Promise.resolve(OK);
  };

describe("two activations released together", () => {
  it("keep a round each, so their files do not collide", async () => {
    const { executor, call } = sessions();
    const rounds: [string, number][] = [];
    const graph = compile(
      [
        "schemaVersion: 1",
        "name: t",
        "nodes:",
        "  a: { type: agent.worker, prompt: a }",
        "  b: { type: agent.worker, prompt: b }",
        "  c: { type: agent.worker, prompt: c }",
        "edges:",
        "  - { from: a, to: c }",
        "  - { from: b, to: c }",
      ].join("\n"),
    );
    const { handle } = start(graph, recordingC(executor, rounds));
    await tick();
    handle.pause("c");
    call("a");
    call("b");
    await tick();
    handle.proceed("c");
    expect((await handle.done).status).toBe("succeeded");
    expect(rounds).toEqual([
      ["c", 1],
      ["c", 2],
    ]);
  });
});

describe("pausing one node", () => {
  it("holds that node alone while the rest of the run goes on", async () => {
    const { executor, call } = sessions();
    const { handle, events } = start(twoWorkers(false), executor);
    await tick();
    handle.pause("a");
    call("a");
    call("b");
    await tick();
    const finished = () => finishedIds(events);
    expect(finished()).toEqual(["b"]);
    expect(events).toContainEqual({ type: "node.held", id: "a", at: "tool" });
    handle.proceed("a");
    expect((await handle.done).status).toBe("succeeded");
    expect(finished()).toEqual(["b", "a"]);
  });
});

describe("stopping one node", () => {
  it("fails it, stopped by the user, and the run goes on", async () => {
    const { executor, call } = sessions();
    const { handle } = start(twoWorkers(false), executor);
    await tick();
    expect(handle.stopNode("nope")).toBe(false);
    expect(handle.stopNode("a")).toBe(true);
    call("b");
    const result = await handle.done;
    expect(result.status).toBe("failed");
    expect(result.nodes).toContainEqual(
      expect.objectContaining({ id: "a", ok: false }),
    );
    expect(result.nodes).toContainEqual(
      expect.objectContaining({ id: "b", ok: true }),
    );
    expect(result.reasons.join("\n")).toContain("a: was stopped");
  });
});

/** Throws for each node what `said` has for it. */
const throwing =
  (said: Record<string, string>): NodeExecutor =>
  context =>
    Promise.reject(new Error(said[context.id] ?? "boom"));

/** Each finished node's end kind, by id. */
const endKinds = (events: readonly RunEvent[]) =>
  Object.fromEntries(
    events.flatMap(e =>
      e.type === "node.finished" ? [[e.id, e.end?.kind]] : [],
    ),
  );

describe("a node whose executor threw", () => {
  it("ends by what the error says, and as unknown when it says nothing Ork knows", async () => {
    const executor = throwing({ a: "git reset failed: spawn git ENOENT" });
    const { handle, events } = start(twoWorkers(false), executor);
    await handle.done;
    expect(endKinds(events)).toEqual({ a: "tool_missing", b: "unknown" });
  });
});

describe("a gate's timer", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts only while its node is not held", async () => {
    vi.useFakeTimers();
    const holds = createHolds({
      onEvent: () => {
        // Not under test.
      },
      onChange: () => {
        // Not under test.
      },
    });
    const hold = holds.forNode("gate");
    holds.pause();
    await tick();
    const outcome: { elapsed?: boolean } = {};
    void heldTimeout(hold, 60, new AbortController().signal).then(value => {
      outcome.elapsed = value;
      return value;
    });
    await vi.advanceTimersByTimeAsync(120);
    expect(outcome.elapsed).toBeUndefined();
    holds.proceed();
    await vi.advanceTimersByTimeAsync(120);
    expect(outcome.elapsed).toBe(true);
  });

  it("says it did not run out when it was given up", async () => {
    const stop = new AbortController();
    const waiting = heldTimeout(undefined, 10_000, stop.signal);
    stop.abort();
    expect(await waiting).toBe(false);
  });
});

/** A store with a live run of `a -> b`, `a` running. */
const liveStore = () => {
  const store = openStore(":memory:");
  const run = store.begin({
    id: "r1",
    workflow: "t",
    file: "/t",
    project: "/p",
  });
  store.append("r1", {
    type: "run.started",
    runId: "r1",
    workflow: "t",
    entries: ["a"],
    nodes: [
      { id: "a", type: "agent.worker" },
      { id: "b", type: "agent.worker" },
    ],
  });
  store.append("r1", {
    type: "node.started",
    id: "a",
    nodeType: "agent.worker",
    round: 1,
  });
  return { store, run, home: mkdtempSync(path.join(tmpdir(), "ork-hold-")) };
};

describe("the commands", () => {
  it("are stored with their node, and reach the run's control once each", async () => {
    const { store, home } = liveStore();
    const asked: string[] = [];
    const emitted: RunEvent[] = [];
    const control = await startControl({
      store,
      runId: "r1",
      home,
      intervalMs: 60_000,
      emit: event => {
        emitted.push(event);
      },
      onMessage: () => {
        // Not under test.
      },
      ...recordingControl(asked),
    });
    store.command("r1", { kind: "pause" });
    store.command("r1", { kind: "pause", node: "b" });
    store.command("r1", { kind: "stop", node: "a" });
    store.command("r1", { kind: "continue" });
    control.check();
    await control.close();
    expect(asked).toEqual(["pause run", "pause b", "stop a", "continue run"]);
    expect(emitted).toEqual([
      { type: "run.command", command: "pause" },
      { type: "run.command", command: "stop", node: "a" },
      { type: "run.command", command: "continue" },
    ]);
  });

  it("show in the run's views: what is paused, and which nodes are held", () => {
    const events: RunEvent[] = [
      { type: "run.command", command: "pause", node: "a" },
      { type: "run.command", command: "pause" },
      { type: "node.held", id: "a", at: "tool" },
    ];
    expect(pausedOf(events)).toEqual({ run: true, nodes: ["a"] });
    expect(
      pausedOf([...events, { type: "run.command", command: "continue" }]),
    ).toEqual({ run: false, nodes: [] });
    const { store } = liveStore();
    for (const event of events) store.append("r1", event);
    const tree = runTree(store.events("r1").map(stored => stored.event));
    expect(tree.find(n => n.id === "a")?.held).toBe(true);
    store.append("r1", { type: "node.released", id: "a" });
    const after = runTree(store.events("r1").map(stored => stored.event));
    expect(after.find(n => n.id === "a")?.held).toBeUndefined();
  });

  it("are refused, in the CLI's words, when they do not fit the run", async () => {
    const { store, run, home } = liveStore();
    expect(await requestStop(store, run, home, "b")).toEqual({
      ok: false,
      error: "b is not running in run r1.",
    });
    expect(await requestStop(store, run, home, "zed")).toEqual({
      ok: false,
      error: "zed is not a node of run r1.",
    });
    expect(await requestContinue(store, run, home)).toEqual({
      ok: false,
      error: "Run r1 is not paused.",
    });
    expect(await requestPause(store, run, home, "a")).toMatchObject({
      ok: true,
    });
    store.append("r1", { type: "run.command", command: "pause", node: "a" });
    expect(await requestPause(store, run, home, "a")).toEqual({
      ok: false,
      error: "a is already paused in run r1.",
    });
    store.append("r1", { type: "run.command", command: "pause" });
    expect(await requestPause(store, run, home)).toEqual({
      ok: false,
      error: "Run r1 is already paused.",
    });
    expect(await requestContinue(store, run, home, "b")).toEqual({
      ok: false,
      error: "Run r1 is paused as a whole; continue the run, not b.",
    });
    expect(await requestContinue(store, run, home)).toMatchObject({ ok: true });
    expect(store.takeCommands("r1")).toEqual([
      { kind: "pause", node: "a" },
      { kind: "continue" },
    ]);
  });
});
