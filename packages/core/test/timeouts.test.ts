/**
 * @file Tests for timeouts: a node that runs out of time, the clock standing
 *   still while the user is waited on, and a run's own timeout.
 */

import { type Node, parseWorkflow, type Workflow } from "@krapht/ork-schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type CompiledGraph,
  compileWorkflow,
  type HumanChannel,
  type NodeExecutor,
  type NodeResult,
  type RunEvent,
  startRun,
} from "../src/index.ts";
import { createHolds } from "../src/run/holds.ts";
import { createClock, timeoutOf, withTimeout } from "../src/run/timeouts.ts";

const compile = (lines: string[]): CompiledGraph => {
  const parsed = parseWorkflow(
    ["schemaVersion: 1", "name: t", ...lines].join("\n"),
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  const { graph, diagnostics } = compileWorkflow(parsed.workflow);
  if (graph === null) throw new Error(JSON.stringify(diagnostics));
  return graph;
};

const OK: NodeResult = { ok: true, output: { status: "pass" } };

/** Works until it is aborted, then hands back what it had. */
const untilAborted: NodeExecutor = ({ signal }) => {
  const { promise, resolve } = Promise.withResolvers<NodeResult>();
  signal.addEventListener("abort", () => {
    resolve({ ok: false, output: { partial: "kept" } });
  });
  return promise;
};

/** Never ends, even when aborted. */
const stuck: NodeExecutor = () =>
  new Promise(() => {
    // Never settles.
  });

/** The fake clock's time, in ms, after which every timer here has fired. */
const SETTLED = 10_000;

const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => {
    setTimeout(resolve, ms);
  });

const answersAfter = (ms: number): HumanChannel => ({
  permit: () => Promise.resolve({ allow: true }),
  ask: async () => {
    await sleep(ms);
    return "yes";
  },
});

const asksThenEnds: NodeExecutor = async ({ human, id }) => {
  await human.ask({ nodeId: id, question: "ok?", options: [{ id: "yes" }] });
  return OK;
};

const run = async (
  graph: CompiledGraph,
  executor: NodeExecutor,
  human: HumanChannel = answersAfter(0),
  onEvent: (event: RunEvent) => void = ignore,
) => {
  const ran: string[] = [];
  const counted: NodeExecutor = context => {
    ran.push(context.id);
    return executor(context);
  };
  const handle = startRun({
    graph,
    inputs: {},
    cwd: process.cwd(),
    executors: { "tool.shell": counted, "claude.worker": counted },
    human,
    onEvent,
    runDir: "/nonexistent",
    timeoutGraceMs: 20,
  });
  const settled = handle.done.then(result => ({ result, ran }));
  // The clock is fake: timeouts and answers come due by moving it, not waiting.
  await vi.advanceTimersByTimeAsync(SETTLED);
  return settled;
};

/** `slow` works until aborted; `recover` keeps the input it was given. */
const recovering = () => {
  const inputs: unknown[] = [];
  const executor: NodeExecutor = context => {
    if (context.id !== "recover") return untilAborted(context);
    inputs.push(context.input);
    return Promise.resolve(OK);
  };
  return { executor, inputs };
};

const ignore = (): void => {
  // Tests here look at results, not events.
};

const workflowWith = (defaults?: Workflow["defaults"]): Workflow => ({
  schemaVersion: 1,
  name: "t",
  nodes: {},
  ...(defaults === undefined ? {} : { defaults }),
});

const waitsUntil = (done: Promise<void>): HumanChannel => ({
  permit: async () => {
    await done;
    return { allow: true };
  },
  ask: async () => {
    await done;
    return "yes";
  },
});

/** Keeps each finished node's end. */
const endsInto =
  (ends: unknown[]) =>
  (event: RunEvent): void => {
    if (event.type === "node.finished") ends.push(event.end);
  };

const limited = (node: string) =>
  compile(["limits: { timeout: 1s }", "nodes:", node]);

const tool = (id: string, extra = ""): string =>
  `  ${id}: { type: tool.shell, command: "true"${extra} }`;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a node's timeout", () => {
  it("fails the node, keeps what it had, and lets an edge handle it", async () => {
    const graph = compile([
      "nodes:",
      tool("slow", ", timeout: 1s"),
      "  recover: { type: claude.worker, prompt: go }",
      "edges:",
      '  - { from: slow, to: recover, when: "timedOut" }',
    ]);
    const { executor, inputs } = recovering();
    const { result, ran } = await run(graph, executor);
    expect(ran).toEqual(["slow", "recover"]);
    expect(result.status).toBe("succeeded");
    expect(inputs).toEqual([
      {
        partial: "kept",
        status: "fail",
        summary: "reached its timeout (1s)",
        timedOut: true,
      },
    ]);
  });

  it("fails the run with the reason when no edge handles it", async () => {
    const graph = compile(["nodes:", tool("slow", ", timeout: 1s")]);
    const { result } = await run(graph, untilAborted);
    expect(result.status).toBe("failed");
    expect(result.reasons.join()).toContain("slow: reached its timeout (1s)");
  });

  it("does not wait for an executor that will not end", async () => {
    const graph = compile(["nodes:", tool("slow", ", timeout: 1s")]);
    const { result } = await run(graph, stuck);
    expect(result.status).toBe("failed");
    expect(result.reasons.join()).toContain("slow: reached its timeout (1s)");
  });

  it("leaves a node alone that ends in time", async () => {
    const graph = compile(["nodes:", tool("quick", ", timeout: 1h")]);
    const { result } = await run(graph, () => Promise.resolve(OK));
    expect(result.status).toBe("succeeded");
  });

  it("does not count time waiting on the user", async () => {
    const graph = compile(["nodes:", tool("asks", ", timeout: 1s")]);
    const { result } = await run(graph, asksThenEnds, answersAfter(1300));
    expect(result.status).toBe("succeeded");
  });
});

describe("timeoutOf", () => {
  const shell = { type: "tool.shell", command: "true" } as const;

  it("is none unless a workflow sets one", () => {
    expect(timeoutOf(shell, workflowWith())).toBeUndefined();
  });

  it("takes the workflow's default, and the node's own over it", () => {
    const defaults = workflowWith({ timeout: "1h" });
    expect(timeoutOf(shell, defaults)).toBe("1h");
    expect(timeoutOf({ ...shell, timeout: "5m" }, defaults)).toBe("5m");
  });

  it("leaves a gate's own timeout to the gate", () => {
    const gate: Node = {
      type: "human.gate",
      question: "ok?",
      options: ["a", "b"],
      timeout: "5m",
      default: "a",
    };
    expect(timeoutOf(gate, workflowWith({ timeout: "1h" }))).toBeUndefined();
  });
});

describe("the clock", () => {
  const owned = compile([
    "nodes:",
    "  lead: { type: claude.leader, prompt: go, maxWorkers: 2 }",
    "  child: { type: claude.worker, prompt: go, parent: lead }",
    "  other: { type: claude.worker, prompt: go }",
  ]);
  const setup = () => {
    const holds = createHolds({
      onEvent: ignore,
      onChange: ignore,
    });
    const running = new Set<string>();
    return {
      holds,
      running,
      clock: createClock({ graph: owned, holds, running }),
    };
  };
  it("stands still for the node that asks and those that own it", async () => {
    const { clock } = setup();
    const answer = Promise.withResolvers<void>();
    const asking = clock
      .human(waitsUntil(answer.promise))
      .ask({ nodeId: "child-2", question: "ok?", options: [] });
    expect(clock.forNode("child-2").held()).toBe(true);
    expect(clock.forNode("lead").held()).toBe(true);
    expect(clock.forNode("other").held()).toBe(false);
    expect(clock.forRun().held()).toBe(true);
    answer.resolve();
    await asking;
    expect(clock.forNode("lead").held()).toBe(false);
    expect(clock.forRun().held()).toBe(false);
  });

  it("stands still for a permission prompt", async () => {
    const { clock } = setup();
    const answer = Promise.withResolvers<void>();
    const asking = clock
      .human(waitsUntil(answer.promise))
      .permit({ nodeId: "other", toolName: "Bash", input: {} });
    expect(clock.forNode("other").held()).toBe(true);
    answer.resolve();
    await asking;
    expect(clock.forNode("other").held()).toBe(false);
  });

  it("stands still for a pause, of the node or one it owns", () => {
    const { clock, holds, running } = setup();
    running.add("child");
    holds.pause("child");
    expect(clock.forNode("child").held()).toBe(true);
    expect(clock.forNode("lead").held()).toBe(true);
    expect(clock.forNode("other").held()).toBe(false);
    expect(clock.forRun().held()).toBe(true);
  });

  it("does not expire while it stands still", async () => {
    const { holds, clock } = setup();
    holds.pause();
    const outcome = { ended: false };
    void withTimeout({
      timeout: "1s",
      clock: clock.forNode("other"),
      signal: new AbortController().signal,
      graceMs: 0,
      start: untilAbortedAlone,
    }).then(() => {
      outcome.ended = true;
      return true;
    });
    await vi.advanceTimersByTimeAsync(1200);
    expect(outcome.ended).toBe(false);
  });
});

const untilAbortedAlone = (signal: AbortSignal): Promise<NodeResult> => {
  const { promise, resolve } = Promise.withResolvers<NodeResult>();
  signal.addEventListener("abort", () => {
    resolve({ ok: false, output: {} });
  });
  return promise;
};

describe("a run's timeout", () => {
  it("stops the run as timed out, and aborts what is running", async () => {
    const { result } = await run(limited(tool("slow")), untilAborted);
    expect(result.status).toBe("timed_out");
    expect(result.reasons.join()).toContain("the run's timeout of 1s passed");
  });

  it("ends what was running as timed out, not interrupted", async () => {
    const ends: unknown[] = [];
    await run(
      limited(tool("slow")),
      untilAborted,
      answersAfter(0),
      endsInto(ends),
    );
    expect(ends).toEqual([
      { kind: "timed_out", message: "reached its timeout (1s)" },
    ]);
  });

  it("ends even when an executor will not", async () => {
    const { result } = await run(limited(tool("slow")), stuck);
    expect(result.status).toBe("timed_out");
  });

  it("does not count time waiting on the user", async () => {
    const { result } = await run(
      limited(tool("asks")),
      asksThenEnds,
      answersAfter(1300),
    );
    expect(result.status).toBe("succeeded");
  });
});
