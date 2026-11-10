/**
 * @file Tests for calling workflows (RFC-004), with a stand-in for starting a
 *   process that records the called run in the store: what is refused, what
 *   comes back, what spends, and what a stop reaches.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  adoptedCalls,
  type CallRequest,
  createCalls,
  type EventStore,
  type NodeResult,
  openStore,
  type RunEvent,
  type RunResult,
  runTree,
  type SessionOutcome,
} from "../src/index.ts";

const ignore = (): void => {
  // These tests look at results, not at this.
};

const request = (over: Partial<CallRequest> = {}): CallRequest => ({
  callId: "kit",
  workflow: "feature",
  inputs: {},
  wait: "run",
  channels: [],
  linked: ignore,
  ...over,
});

const NODES = [{ id: "builder", type: "claude.worker" }] as const;

const finishedWith = (id: string, over: Partial<RunResult> = {}): RunEvent => ({
  type: "run.finished",
  result: {
    runId: id,
    status: "succeeded",
    costUsd: 0,
    nodes: [],
    reasons: [],
    worktrees: [],
    ...over,
  },
});

const signal = (): AbortSignal => new AbortController().signal;

const usageWith = (costUsd: number) => ({
  costUsd,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  turns: 1,
  durationMs: 0,
});

/** The called node's report. */
const reported = (costUsd = 0): RunEvent => ({
  type: "node.finished",
  id: "builder",
  round: 1,
  ok: true,
  output: { status: "pass", summary: "built" },
  usage: usageWith(costUsd),
});

const resumedOutcome = (): SessionOutcome => ({
  subtype: "success",
  sessionId: "s1",
  text: "",
  report: { status: "pass", summary: "fixed", artifacts: {}, fields: {} },
  usage: usageWith(0.25),
  errors: [],
});

/** The called node's session, reporting `cost` as its total so far. */
const sessionTotal = (cost: number): RunEvent => ({
  type: "node.event",
  id: "builder",
  event: {
    type: "session.finished",
    outcome: { ...resumedOutcome(), usage: usageWith(cost) },
  },
});

/** The caller started a run, before it was stopped or crashed. */
const earlierCall = (store: EventStore, id = "earlier1"): void => {
  store.begin({
    id,
    workflow: "f",
    file: "f",
    project: "/p",
    parent: "caller00",
  });
  store.append("caller00", {
    type: "call.started",
    node: "kit",
    run: id,
    workflow: "feature",
    project: "/p",
  });
};

/** The caller's node finished well with the run's result. */
const keptResult = (store: EventStore, run: string): void => {
  store.append("caller00", {
    type: "node.finished",
    id: "kit",
    round: 1,
    ok: true,
    output: { status: "pass", run },
  });
};

describe("calling a workflow", () => {
  let dir: string;
  let store: EventStore;
  let seen: { args: readonly string[]; cwd: string }[];
  let ids: number;
  const emitted: RunEvent[] = [];

  const placeAt = (name: string, workflows: string[] = ["feature"]) => {
    const root = path.join(dir, name);
    const orkDir = path.join(root, ".ork");
    mkdirSync(path.join(orkDir, "workflows"), { recursive: true });
    for (const workflow of workflows) {
      writeFileSync(
        path.join(orkDir, "workflows", `${workflow}.ork.yaml`),
        "x",
      );
    }
    return { id: name, root, dir: orkDir, mode: "in-repo" as const };
  };

  /** The called run: recorded as a process would, and ended as `act` says. */
  const portFor = (
    act: (id: string) => void,
    own = placeAt("own"),
    over: Partial<Parameters<typeof createCalls>[0]> = {},
  ) =>
    createCalls({
      store,
      runId: "caller00",
      place: own,
      emit: event => {
        emitted.push(event);
      },
      newId: () => {
        ids += 1;
        return `called0${String(ids)}`;
      },
      detach: ({ runId, args, cwd }) => {
        seen.push({ args, cwd });
        store.begin({
          id: runId,
          workflow: "feature",
          file: "f",
          project: cwd,
          parent: "caller00",
        });
        store.append(runId, {
          type: "run.started",
          runId,
          workflow: "feature",
          entries: [],
          nodes: [...NODES],
        });
        act(runId);
        return Promise.resolve({ ok: true, runId, log: "" });
      },
      ...over,
    });

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ork-calls-"));
    store = openStore(":memory:");
    store.begin({ id: "caller00", workflow: "w", file: "f", project: "/p" });
    seen = [];
    ids = 0;
    emitted.length = 0;
  });
  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("starts the workflow as its own run, and returns its outputs", async () => {
    const port = portFor(id => {
      store.append(id, finishedWith(id, { outputs: { version: "4.9.2" } }));
    });
    const result = await port.invoke(request(), signal());
    expect(result).toMatchObject({
      ok: true,
      output: {
        status: "pass",
        run: "called01",
        runStatus: "succeeded",
        outputs: { version: "4.9.2" },
      },
    });
    expect(emitted).toMatchObject([
      { type: "call.started", node: "kit", run: "called01" },
    ]);
  });

  it("fails the node with the run's reasons when it fails", async () => {
    const port = portFor(id => {
      store.append(
        id,
        finishedWith(id, { status: "failed", reasons: ["build broke"] }),
      );
    });
    const result = await port.invoke(request(), signal());
    expect(result.ok).toBe(false);
    expect(result.end?.detail).toContain("build broke");
    expect(result.output).toMatchObject({
      status: "fail",
      runStatus: "failed",
    });
  });

  it("passes inputs, the caller, what is left of the budget, and the ref", async () => {
    const port = portFor(id => {
      store.append(id, finishedWith(id));
    });
    await port.invoke(
      request({ inputs: { a: "1 2" }, budgetLeftUsd: 1.5, ref: "ork/x" }),
      signal(),
    );
    expect(seen[0]?.args).toEqual([
      "run",
      expect.stringContaining("feature.ork.yaml"),
      "--run-id",
      "called01",
      "--called-by",
      "caller00/kit",
      "--input",
      "a=1 2",
      "--budget-cap",
      "1.5",
      "--base-ref",
      "ork/x",
    ]);
  });

  it("starts the called run with the machine's Claude setup when the caller has it", async () => {
    const port = portFor(
      id => {
        store.append(id, finishedWith(id));
      },
      placeAt("own"),
      { machineClaude: true },
    );
    await port.invoke(request(), signal());
    expect(seen[0]?.args.at(-1)).toBe("--machine-claude");
    const clean = portFor(id => {
      store.append(id, finishedWith(id));
    });
    await clean.invoke(request(), signal());
    expect(seen[1]?.args).not.toContain("--machine-claude");
  });

  it("counts what the called run spent, once", async () => {
    const port = portFor(id => {
      store.append(id, {
        type: "node.finished",
        id: "builder",
        round: 1,
        ok: true,
        output: {},
        usage: {
          costUsd: 0.25,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          turns: 1,
          durationMs: 0,
        },
      });
      store.append(id, finishedWith(id, { costUsd: 0.25 }));
    });
    const result = await port.invoke(request(), signal());
    expect(result.usage?.costUsd).toBe(0.25);
  });

  it("runs a new run for each activation of a call with no node", async () => {
    const port = portFor(id => {
      store.append(id, finishedWith(id));
    });
    await port.invoke(request(), signal());
    await port.invoke(request(), signal());
    expect(seen).toHaveLength(2);
  });

  it("does not wait with wait: none", async () => {
    const port = portFor(ignore);
    const result = await port.invoke(request({ wait: "none" }), signal());
    expect(result).toMatchObject({
      ok: true,
      output: { status: "pass", run: "called01" },
    });
  });

  it("returns a named node's report, before its run ends", async () => {
    const port = portFor(id => {
      store.append(id, {
        type: "node.finished",
        id: "builder",
        round: 1,
        ok: true,
        output: { status: "pass", summary: "built" },
      });
    });
    const result = await port.invoke(
      request({ node: "builder", wait: "node" }),
      signal(),
    );
    expect(result).toMatchObject({
      ok: true,
      output: { summary: "built", run: "called01" },
    });
  });

  it("fails when the run ends before the node reports", async () => {
    const port = portFor(id => {
      store.append(id, finishedWith(id, { status: "failed" }));
    });
    const result = await port.invoke(
      request({ node: "builder", wait: "node" }),
      signal(),
    );
    expect(result.ok).toBe(false);
    expect(result.output["summary"]).toContain(
      "builder of run called01 did not report",
    );
  });

  it("keeps one run for a call with a node, and tells its live session the next input", async () => {
    const port = portFor(ignore);
    await port.invoke(request({ node: "builder", wait: "none" }), signal());
    const second = port.invoke(
      request({ node: "builder", wait: "node", input: { fix: "it" } }),
      signal(),
    );
    await vi.waitFor(() => {
      expect(
        store.takeCommands("called01").filter(c => c.kind === "relay"),
      ).toMatchObject([
        {
          node: "builder",
          from: "caller00/kit",
          body: JSON.stringify({ fix: "it" }),
        },
      ]);
    });
    store.append("called01", reported());
    await expect(second).resolves.toMatchObject({ ok: true });
    expect(seen).toHaveLength(1);
  });

  it("resumes a session that has ended, with the next input, and counts what it spent", async () => {
    const resumed: string[] = [];
    const port = portFor(
      id => {
        store.append(id, reported(0.5));
        store.append(id, finishedWith(id, { costUsd: 0.5 }));
      },
      placeAt("own"),
      {
        resumeSession: (run, node, body) => {
          resumed.push(`${run.id}/${node}:${body}`);
          store.append(run.id, {
            type: "node.event",
            id: node,
            event: {
              type: "session.finished",
              outcome: resumedOutcome(),
            },
          });
          return Promise.resolve(null);
        },
      },
    );
    const first = await port.invoke(
      request({ node: "builder", wait: "node" }),
      signal(),
    );
    expect(first.usage?.costUsd).toBe(0.5);
    const second = await port.invoke(
      request({ node: "builder", wait: "node", input: { fix: "it" } }),
      signal(),
    );
    expect(resumed).toEqual([
      expect.stringContaining(
        'called01/builder:[ork] The workflow that called this run activated it again, from caller00/kit. This is from that workflow, not from the user. Its input: {"fix":"it"}',
      ),
    ]);
    expect(second).toMatchObject({
      ok: true,
      output: { summary: "fixed", run: "called01" },
      usage: { costUsd: 0.25 },
    });
    expect(seen).toHaveLength(1);
  });

  it("charges the caller only what a resumed session added", async () => {
    const port = portFor(
      id => {
        store.append(id, sessionTotal(4));
        store.append(id, reported(4));
        store.append(id, finishedWith(id, { costUsd: 4 }));
      },
      placeAt("own"),
      {
        resumeSession: run => {
          store.append(run.id, sessionTotal(4.1));
          return Promise.resolve(null);
        },
      },
    );
    await port.invoke(request({ node: "builder", wait: "node" }), signal());
    const second = await port.invoke(
      request({ node: "builder", wait: "node", input: { fix: "it" } }),
      signal(),
    );
    expect(second.usage?.costUsd).toBeCloseTo(0.1);
  });

  it("waits for the run to end before resuming a node that has reported", async () => {
    const resumed: string[] = [];
    const port = portFor(
      id => {
        store.append(id, reported());
      },
      placeAt("own"),
      {
        resumeSession: (run, node) => {
          resumed.push(`${run.id}/${node}`);
          return Promise.resolve("not this time");
        },
      },
    );
    await port.invoke(request({ node: "builder", wait: "node" }), signal());
    const second = port.invoke(
      request({ node: "builder", wait: "node" }),
      signal(),
    );
    await vi.waitFor(() => {
      expect(emitted).toHaveLength(1);
    });
    expect(resumed).toEqual([]);
    store.append("called01", finishedWith("called01"));
    await expect(second).resolves.toMatchObject({
      ok: false,
      error: "not this time",
    });
    expect(resumed).toEqual(["called01/builder"]);
  });

  it("links the nodes in its channels, and says the address", async () => {
    store.append("caller00", {
      type: "run.started",
      runId: "caller00",
      workflow: "w",
      entries: [],
      nodes: [...NODES],
    });
    const linked: string[] = [];
    const port = portFor(ignore);
    const result = await port.invoke(
      request({
        node: "builder",
        wait: "none",
        channels: ["builder"],
        maxMessages: 7,
        linked: address => {
          linked.push(address);
        },
      }),
      signal(),
    );
    expect(result.ok).toBe(true);
    expect(linked).toEqual(["called01/builder"]);
    expect(JSON.stringify(store.takeCommands("called01"))).toContain(
      "[ork] A workflow.call linked you with",
    );
    expect(store.links({ live: true })).toMatchObject([
      {
        a: { run: "caller00", node: "builder" },
        b: { run: "called01", node: "builder" },
        maxMessages: 7,
      },
    ]);
  });

  it("refuses a project that is not registered", async () => {
    const result = await portFor(ignore).invoke(
      request({ project: "kit" }),
      signal(),
    );
    expect(result.error).toContain("No registered project `kit`");
    expect(seen).toEqual([]);
  });

  it("refuses a workflow that is not there", async () => {
    const result = await portFor(ignore).invoke(
      request({ workflow: "ghost" }),
      signal(),
    );
    expect(result.error).toContain("No workflow `ghost`");
  });

  it("refuses to nest too deep", async () => {
    store.begin({
      id: "a1",
      workflow: "w",
      file: "f",
      project: "/p",
      parent: "caller00",
    });
    store.begin({
      id: "a2",
      workflow: "w",
      file: "f",
      project: "/p",
      parent: "a1",
    });
    store.begin({
      id: "a3",
      workflow: "w",
      file: "f",
      project: "/p",
      parent: "a2",
    });
    store.begin({
      id: "a4",
      workflow: "w",
      file: "f",
      project: "/p",
      parent: "a3",
    });
    store.begin({
      id: "a5",
      workflow: "w",
      file: "f",
      project: "/p",
      parent: "a4",
    });
    const result = await portFor(ignore, placeAt("own"), {
      runId: "a5",
    }).invoke(request(), signal());
    expect(result.error).toContain("nest too deep");
  });

  it("stops the called run when the node is aborted", async () => {
    const abort = new AbortController();
    const running = portFor(ignore).invoke(request(), abort.signal);
    await vi.waitFor(() => {
      expect(seen).toHaveLength(1);
    });
    abort.abort();
    const result = await running;
    expect(result.ok).toBe(false);
    expect(store.takeCommands("called01")).toEqual([{ kind: "stop" }]);
  });

  it("stops every run it called when told, even those not waited on", async () => {
    const port = portFor(ignore);
    await port.invoke(request({ wait: "none" }), signal());
    await port.invoke(request({ wait: "none" }), signal());
    port.stopAll();
    expect(store.takeCommands("called01")).toEqual([{ kind: "stop" }]);
    expect(store.takeCommands("called02")).toEqual([{ kind: "stop" }]);
  });

  it("attaches to a run started before a resume, once", async () => {
    earlierCall(store);
    const adopt = adoptedCalls(store, "caller00");
    expect([...adopt]).toMatchObject([
      ["kit", { open: ["earlier1"], last: "earlier1" }],
    ]);
    store.append("earlier1", finishedWith("earlier1"));
    const port = portFor(
      id => {
        store.append(id, finishedWith(id));
      },
      placeAt("own"),
      { adopt },
    );
    const first: NodeResult = await port.invoke(request(), signal());
    expect(first.output).toMatchObject({ run: "earlier1" });
    expect(seen).toEqual([]);
    const second = await port.invoke(request(), signal());
    expect(second.output).toMatchObject({ run: "called01" });
  });

  it("starts a new run when the last call's result is already the caller's", async () => {
    earlierCall(store);
    keptResult(store, "earlier1");
    const adopt = adoptedCalls(store, "caller00");
    expect([...adopt]).toMatchObject([["kit", { open: [], last: "earlier1" }]]);
    const port = portFor(
      id => {
        store.append(id, finishedWith(id));
      },
      placeAt("own"),
      { adopt },
    );
    const result = await port.invoke(request(), signal());
    expect(result.output).toMatchObject({ run: "called01" });
  });

  it("keeps parallel activations open apart, by the run each result names", () => {
    earlierCall(store, "earlier1");
    earlierCall(store, "earlier2");
    earlierCall(store, "earlier3");
    keptResult(store, "earlier2");
    expect([...adoptedCalls(store, "caller00")]).toMatchObject([
      ["kit", { open: ["earlier1", "earlier3"], last: "earlier3" }],
    ]);
  });

  it("keeps a call open when its node was stopped or failed", () => {
    earlierCall(store);
    store.append("caller00", {
      type: "node.finished",
      id: "kit",
      round: 1,
      ok: false,
      output: { status: "fail", run: "earlier1" },
    });
    expect([...adoptedCalls(store, "caller00")]).toMatchObject([
      ["kit", { open: ["earlier1"], last: "earlier1" }],
    ]);
  });

  it("brings back a called run a stop ended, and reads what it does next", async () => {
    earlierCall(store);
    store.append(
      "earlier1",
      finishedWith("earlier1", { status: "interrupted" }),
    );
    const adopt = adoptedCalls(store, "caller00");
    const resumed: string[] = [];
    const port = portFor(ignore, placeAt("own"), {
      adopt,
      resume: run => {
        resumed.push(run.id);
        store.append(run.id, finishedWith(run.id));
        return Promise.resolve({ ok: true, runId: run.id, log: "" });
      },
    });
    const result = await port.invoke(request(), signal());
    expect(resumed).toEqual(["earlier1"]);
    expect(result).toMatchObject({
      ok: true,
      output: { run: "earlier1", runStatus: "succeeded" },
    });
  });

  it("gives a failed called run its retry, as a resume does a failed node", async () => {
    earlierCall(store);
    store.append(
      "earlier1",
      finishedWith("earlier1", { status: "failed", reasons: ["broke"] }),
    );
    const resumed: string[] = [];
    const port = portFor(ignore, placeAt("own"), {
      adopt: adoptedCalls(store, "caller00"),
      resume: run => {
        resumed.push(run.id);
        store.append(run.id, finishedWith(run.id));
        return Promise.resolve({ ok: true, runId: run.id, log: "" });
      },
    });
    const result = await port.invoke(request(), signal());
    expect(resumed).toEqual(["earlier1"]);
    expect(result.ok).toBe(true);
  });

  it("reads the result of a called run that succeeded meanwhile", async () => {
    earlierCall(store);
    store.append(
      "earlier1",
      finishedWith("earlier1", { outputs: { version: "1" } }),
    );
    const resumed: string[] = [];
    const port = portFor(ignore, placeAt("own"), {
      adopt: adoptedCalls(store, "caller00"),
      resume: run => {
        resumed.push(run.id);
        return Promise.resolve({ ok: true, runId: run.id, log: "" });
      },
    });
    const result = await port.invoke(request(), signal());
    expect(resumed).toEqual([]);
    expect(result.output).toMatchObject({ outputs: { version: "1" } });
  });

  it("reports a called run that could not be resumed", async () => {
    earlierCall(store);
    store.append(
      "earlier1",
      finishedWith("earlier1", { status: "interrupted" }),
    );
    const port = portFor(ignore, placeAt("own"), {
      adopt: adoptedCalls(store, "caller00"),
      resume: run =>
        Promise.resolve({ ok: false, runId: run.id, error: "dirty", log: "" }),
    });
    const result = await port.invoke(request(), signal());
    expect(result.error).toBe(
      "could not start: Run earlier1 could not be resumed: dirty",
    );
  });

  it("goes on with a conversation left between activations by a resume", async () => {
    earlierCall(store);
    keptResult(store, "earlier1");
    store.append("earlier1", finishedWith("earlier1"));
    const resumed: string[] = [];
    const port = portFor(ignore, placeAt("own"), {
      adopt: adoptedCalls(store, "caller00"),
      resumeSession: (run, node) => {
        resumed.push(`${run.id}/${node}`);
        return Promise.resolve("refused");
      },
    });
    await port.invoke(request({ node: "builder", wait: "node" }), signal());
    expect(resumed).toEqual(["earlier1/builder"]);
    expect(seen).toEqual([]);
  });

  it("reads a called run's latest go, not an end from before it was resumed", async () => {
    earlierCall(store);
    store.append("earlier1", finishedWith("earlier1", { status: "failed" }));
    store.append("earlier1", {
      type: "run.resumed",
      kept: [],
    });
    store.append(
      "earlier1",
      finishedWith("earlier1", { outputs: { version: "2" } }),
    );
    const port = portFor(ignore, placeAt("own"), {
      adopt: adoptedCalls(store, "caller00"),
    });
    const result = await port.invoke(request(), signal());
    expect(result).toMatchObject({
      ok: true,
      output: { outputs: { version: "2" } },
    });
  });

  it("takes a report made before the caller came back, as a resumed run repeats none", async () => {
    earlierCall(store);
    store.append("earlier1", reported());
    store.append("earlier1", finishedWith("earlier1", { status: "failed" }));
    const port = portFor(ignore, placeAt("own"), {
      adopt: adoptedCalls(store, "caller00"),
      resume: run => Promise.resolve({ ok: true, runId: run.id, log: "" }),
    });
    const result = await port.invoke(
      request({ node: "builder", wait: "node" }),
      signal(),
    );
    expect(result).toMatchObject({
      ok: true,
      output: { summary: "built", run: "earlier1" },
    });
  });

  it("keeps a run open when its result comes after the node's first failure, which a resume drops", () => {
    earlierCall(store, "earlier1");
    earlierCall(store, "earlier2");
    store.append("caller00", {
      type: "node.finished",
      id: "kit",
      round: 1,
      ok: false,
      output: { status: "fail", run: "earlier1" },
    });
    keptResult(store, "earlier2");
    expect([...adoptedCalls(store, "caller00")]).toMatchObject([
      ["kit", { open: ["earlier1", "earlier2"] }],
    ]);
  });

  it("does not count again what the results a resume keeps already counted", async () => {
    earlierCall(store);
    store.append("earlier1", reported(0.5));
    store.append("caller00", {
      type: "node.finished",
      id: "kit",
      round: 1,
      ok: true,
      output: { status: "pass", run: "earlier1" },
      usage: usageWith(0.5),
    });
    store.append("earlier1", finishedWith("earlier1", { costUsd: 0.5 }));
    const port = portFor(ignore, placeAt("own"), {
      adopt: adoptedCalls(store, "caller00"),
      resumeSession: (run, node) => {
        store.append(run.id, {
          type: "node.event",
          id: node,
          event: { type: "session.finished", outcome: resumedOutcome() },
        });
        return Promise.resolve(null);
      },
    });
    const result = await port.invoke(
      request({ node: "builder", wait: "node" }),
      signal(),
    );
    expect(result.usage?.costUsd).toBe(0.25);
  });

  it("brings back a conversation's stopped run, with its nodes yet to run", async () => {
    earlierCall(store);
    keptResult(store, "earlier1");
    store.append(
      "earlier1",
      finishedWith("earlier1", { status: "interrupted" }),
    );
    const resumed: string[] = [];
    const port = portFor(ignore, placeAt("own"), {
      adopt: adoptedCalls(store, "caller00"),
      resume: run => {
        resumed.push(run.id);
        return Promise.resolve({ ok: true, runId: run.id, log: "" });
      },
      resumeSession: () => Promise.resolve("refused"),
    });
    await port.invoke(request({ node: "builder", wait: "node" }), signal());
    expect(resumed).toEqual(["earlier1"]);
  });

  it("does not wait on a later activation with wait: none", async () => {
    const port = portFor(ignore);
    await port.invoke(request({ node: "builder", wait: "none" }), signal());
    const second = await port.invoke(
      request({ node: "builder", wait: "none", input: { more: "work" } }),
      signal(),
    );
    expect(second).toMatchObject({ ok: true, output: { run: "called01" } });
    expect(
      store.takeCommands("called01").filter(c => c.kind === "relay"),
    ).toHaveLength(1);
  });

  it("stops a run started while the node was being stopped, even with wait: none", async () => {
    const abort = new AbortController();
    const port = portFor(() => {
      abort.abort();
    });
    await port.invoke(request({ wait: "none" }), abort.signal);
    expect(store.takeCommands("called01")).toEqual([{ kind: "stop" }]);
  });

  it("says why when a named node's report fails", async () => {
    const port = portFor(id => {
      store.append(id, {
        type: "node.finished",
        id: "builder",
        round: 1,
        ok: false,
        output: { status: "fail", summary: "tests broke" },
      });
    });
    const result = await port.invoke(
      request({ node: "builder", wait: "node" }),
      signal(),
    );
    expect(result).toMatchObject({
      ok: false,
      output: { summary: "tests broke" },
    });
  });

  it("carries up how the called node ended", async () => {
    const end = { kind: "turn_limit", message: "reached its turn limit (8)" };
    const port = portFor(id => {
      store.append(id, {
        type: "node.finished",
        id: "builder",
        round: 1,
        ok: false,
        output: { status: "fail", summary: "out of turns" },
        end: { kind: "turn_limit", message: "reached its turn limit (8)" },
      });
    });
    const result = await port.invoke(
      request({ node: "builder", wait: "node" }),
      signal(),
    );
    expect(result).toMatchObject({ error: end.message, end });
  });

  it("refuses a workflow name that walks out of the workflows folder", async () => {
    const own = placeAt("own");
    const outside = path.join(own.root, "elsewhere.ork.yaml");
    writeFileSync(outside, "x");
    const result = await portFor(ignore, own).invoke(
      request({ workflow: "../../elsewhere" }),
      signal(),
    );
    expect(result.error).toContain("is not a workflow's name");
    expect(seen).toEqual([]);
  });

  it("keeps out a project its target's calls.accept does not name", async () => {
    const own = placeAt("own");
    store.addProject(own);
    const kit = placeAt("kit");
    store.addProject(kit);
    writeFileSync(
      path.join(kit.dir, "project.yaml"),
      "schemaVersion: 1\ncalls:\n  accept: [someone]\n",
    );
    const result = await portFor(ignore, own).invoke(
      request({ project: "kit" }),
      signal(),
    );
    expect(result.error).toContain("does not accept calls from own");
    expect(seen).toEqual([]);
  });

  it("lets in a project its target's calls.accept names", async () => {
    const own = placeAt("own");
    store.addProject(own);
    const kit = placeAt("kit");
    store.addProject(kit);
    writeFileSync(
      path.join(kit.dir, "project.yaml"),
      "schemaVersion: 1\ncalls:\n  accept: [own]\n",
    );
    const port = portFor(id => {
      store.append(id, finishedWith(id));
    }, own);
    const result = await port.invoke(request({ project: "kit" }), signal());
    expect(result.ok).toBe(true);
    expect(seen[0]?.cwd).toBe(kit.root);
  });

  it("shows in the tree which run a call started, and a session's model", () => {
    store.append("caller00", {
      type: "run.started",
      runId: "caller00",
      workflow: "w",
      entries: [],
      nodes: [
        { id: "kit", type: "workflow.call" },
        { id: "builder", type: "claude.worker" },
      ],
    });
    earlierCall(store);
    store.append("caller00", {
      type: "node.event",
      id: "builder",
      event: { type: "session.started", sessionId: "s", model: "opus" },
    });
    expect(
      runTree(store.events("caller00").map(({ event }) => event)),
    ).toMatchObject([
      { id: "kit", calledRun: "earlier1" },
      { id: "builder", model: "opus" },
    ]);
  });

  it("records a called run's parent and depth", () => {
    store.begin({
      id: "c1",
      workflow: "w",
      file: "f",
      project: "/p",
      parent: "caller00",
    });
    expect(store.lookup("c1")[0]).toMatchObject({
      parent: "caller00",
      depth: 1,
    });
    expect(store.lookup("caller00")[0]).toMatchObject({ depth: 0 });
  });
});
