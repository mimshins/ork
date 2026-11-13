/**
 * @file Tests for heavy tool commands: three of them with two machine-wide
 *   slots run two at once, the third waits until one ends, says who holds the
 *   slots, and records the CPU its command used; the project's priority reaches
 *   the runner. A run's machine reaches its tool nodes, and a step's timeout
 *   starts once its command has a slot. A shell `script:` waits when one of its
 *   commands is heavy.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import {
  compileWorkflow,
  type ExecuteContext,
  fileSlotLedger,
  type MachinePort,
  machinePort,
  type RunEvent,
  type RuntimeEvent,
  startRun,
} from "@krapht/ork-core";
import { type Node, parseWorkflow } from "@krapht/ork-schema";
import { describe, expect, it, vi } from "vitest";

import { toolExecutor, type ToolRunner } from "../src/index.ts";
import { runStep } from "../src/verify.ts";

const command: Node = { type: "tool.shell", command: "pnpm check" };

const contextFor = (
  id: string,
  machine: ExecuteContext["machine"],
  node: Node = command,
): ExecuteContext & { events: RuntimeEvent[] } => {
  const events: RuntimeEvent[] = [];
  const cwd = mkdtempSync(path.join(tmpdir(), "ork-heavy-"));
  return {
    runId: "r1",
    id,
    node,
    workflow: { schemaVersion: 1, name: "t", nodes: { [id]: node } },
    inputs: {},
    outputs: {},
    input: undefined,
    round: 1,
    cwd,
    runDir: path.join(cwd, ".ork/runs/r1"),
    workflowDir: cwd,
    projectRoot: cwd,
    budgetLeftUsd: undefined,
    human: {
      ask: () => Promise.resolve(""),
      permit: () => Promise.resolve({ allow: false, message: "no" }),
    },
    emit: event => {
      events.push(event);
    },
    signal: new AbortController().signal,
    ...(machine === undefined ? {} : { machine }),
    events,
  };
};

describe("heavy tool commands", () => {
  it("run two at once with two slots; the third waits, told who holds them", async () => {
    const ledger = fileSlotLedger({
      dir: mkdtempSync(path.join(tmpdir(), "ork-slots-")),
      slots: 2,
      pollMs: 10,
    });
    const runEvents: RunEvent[] = [];
    const port = (id: string) =>
      machinePort(
        {
          machine: {
            rules: { heavy: ["pnpm check"], priority: "low" },
            ledger,
          },
          onEvent: event => {
            runEvents.push(event);
          },
        },
        "r1",
        id,
        { waitFor: (_, wait) => wait() },
      );
    const started: string[] = [];
    const ends = new Map<string, () => void>();
    const priorities: unknown[] = [];
    const runner: ToolRunner = (_program, _args, { cwd, priority }) => {
      priorities.push(priority);
      const id = path.basename(cwd);
      started.push(id);
      return new Promise(resolve => {
        ends.set(id, () => {
          resolve({
            exitCode: 0,
            stdout: "",
            stderr: "",
            cpu: { userMs: 1200, systemMs: 300 },
          });
        });
      });
    };
    const contexts = ["a", "b", "c"].map(id => {
      const context = contextFor(id, port(id));
      return { id, context: { ...context, cwd: path.join(context.cwd, id) } };
    });
    const runs = contexts.map(({ context }) => toolExecutor(runner)(context));
    await vi.waitFor(() => {
      expect(started).toHaveLength(2);
    });
    await sleep(50);
    expect(started).toEqual(["a", "b"]);
    expect(runEvents).toEqual([
      { type: "slot.waiting", id: "c", holders: ["r1/a", "r1/b"] },
    ]);
    ends.get("a")?.();
    await vi.waitFor(() => {
      expect(started).toEqual(["a", "b", "c"]);
    });
    expect(runEvents.at(-1)).toEqual({ type: "slot.taken", id: "c" });
    ends.get("b")?.();
    ends.get("c")?.();
    await Promise.all(runs);
    expect(priorities).toEqual(["low", "low", "low"]);
    const [first] = contexts;
    expect(first?.context.events.at(-1)).toEqual({
      type: "tool.result",
      id: "a",
      isError: false,
      cpu: { userMs: 1200, systemMs: 300 },
    });
  });
});

const okRunner =
  (priorities: unknown[]): ToolRunner =>
  (_program, _args, { priority }) => {
    priorities.push(priority);
    return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
  };

/** A one-slot ledger another run holds, and the release of its slot. */
const takenLedger = async () => {
  const ledger = fileSlotLedger({
    dir: mkdtempSync(path.join(tmpdir(), "ork-slots-")),
    slots: 1,
    pollMs: 10,
  });
  const other = await ledger.take(
    { run: "r0", node: "check", pid: process.pid },
    { signal: new AbortController().signal },
  );
  return { ledger, freeOther: () => other?.() };
};

/** A compiled workflow of one tool node, `x`. */
const oneToolNode = () => {
  const parsed = parseWorkflow(
    [
      "schemaVersion: 1",
      "name: t",
      "nodes:",
      "  x: { type: tool.shell, command: x }",
    ].join("\n"),
  );
  if (!parsed.ok) throw new Error("bad workflow");
  const { graph } = compileWorkflow(parsed.workflow);
  if (graph === null) throw new Error("does not compile");
  return graph;
};

describe("a run's machine", () => {
  it("reaches its tool nodes: a heavy command waits, at the project's priority", async () => {
    const graph = oneToolNode();
    const { ledger, freeOther } = await takenLedger();
    const events: RunEvent[] = [];
    const priorities: unknown[] = [];
    const done = startRun({
      graph,
      inputs: {},
      cwd: mkdtempSync(path.join(tmpdir(), "ork-machine-")),
      executors: { "tool.shell": toolExecutor(okRunner(priorities)) },
      human: {
        ask: () => Promise.resolve(""),
        permit: () => Promise.resolve({ allow: false, message: "no" }),
      },
      onEvent: event => {
        events.push(event);
      },
      machine: { rules: { heavy: ["x"], priority: "low" }, ledger },
    }).done;
    await vi.waitFor(() => {
      expect(events.some(e => e.type === "slot.waiting")).toBe(true);
    });
    freeOther();
    expect((await done).status).toBe("succeeded");
    expect(events).toContainEqual({
      type: "slot.waiting",
      id: "x",
      holders: ["r0/check"],
    });
    expect(events).toContainEqual({ type: "slot.taken", id: "x" });
    expect(priorities).toEqual(["low"]);
    expect(ledger.holders()).toEqual([]);
  });

  it("starts a step's timeout once its command has a slot", async () => {
    const { ledger, freeOther } = await takenLedger();
    const port = machinePort(
      {
        machine: {
          rules: { heavy: ["pnpm check"], priority: "normal" },
          ledger,
        },
        onEvent: () => {
          // Not under test.
        },
      },
      "r1",
      "build",
      { waitFor: (_, wait) => wait() },
    );
    const context = contextFor("build", port);
    const later = sleep(1500).then(freeOther);
    const result = await runStep(
      toolExecutor(okRunner([])),
      context,
      { command: "pnpm check", timeout: "1s" },
      { name: "verify", try: 1 },
    );
    await later;
    expect(result.ok).toBe(true);
  });
});

/** What a node asks its machine port for, through a port that takes no slot. */
const askedSlot = async (shell: Node): Promise<unknown> => {
  let asked: unknown;
  const port: MachinePort = {
    priority: "normal",
    slot: (text, _signal, run) => {
      asked = { text, ...run };
      return Promise.resolve(() => {
        // Nothing was taken.
      });
    },
  };
  await toolExecutor(okRunner([]))(contextFor("n", port, shell));
  return asked;
};

describe("a shell script's slot", () => {
  it("is asked with the script for a shell interpreter only", async () => {
    const nodes: Node[] = [
      { type: "tool.shell", script: "sleep 9151" },
      { type: "tool.shell", script: "sleep 9151", interpreter: "/bin/bash" },
      { type: "tool.shell", script: "sleep 9151", interpreter: "node" },
      { type: "tool.shell", command: "sleep 9151" },
    ];
    const asked = await Promise.all(nodes.map(shell => askedSlot(shell)));
    expect(asked).toEqual([
      { text: "sh -eu", script: "sleep 9151" },
      { text: "/bin/bash", script: "sleep 9151" },
      { text: "node" },
      { text: "sleep 9151" },
    ]);
  });

  it("makes a second run of a heavy script wait for the first", async () => {
    const { ledger, freeOther } = await takenLedger();
    const runEvents: RunEvent[] = [];
    const port = machinePort(
      {
        machine: {
          rules: { heavy: ["sleep 9151"], priority: "normal" },
          ledger,
        },
        onEvent: event => {
          runEvents.push(event);
        },
      },
      "r1",
      "s",
      { waitFor: (_, wait) => wait() },
    );
    const started: string[] = [];
    const runner: ToolRunner = program => {
      started.push(program);
      return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
    };
    const script: Node = { type: "tool.shell", script: "echo a\nsleep 9151" };
    const run = toolExecutor(runner)(contextFor("s", port, script));
    await vi.waitFor(() => {
      expect(runEvents).toEqual([
        { type: "slot.waiting", id: "s", holders: ["r0/check"] },
      ]);
    });
    expect(started).toEqual([]);
    freeOther();
    await run;
    expect(started).toEqual(["sh"]);
    expect(runEvents.at(-1)).toEqual({ type: "slot.taken", id: "s" });
  });
});
