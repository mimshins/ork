/**
 * @file Tests for the scheduler on scripted executors: the software-factory
 *   example, loops, failures, joins and routers, the budget, concurrency and
 *   interrupts.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { parseWorkflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import {
  compileWorkflow,
  type CompiledGraph,
  type HumanChannel,
  type NodeExecutor,
  type NodeExecutors,
  type NodeResult,
  type RunEvent,
  startRun,
} from "../src/index.ts";

const repoRoot = path.resolve(import.meta.dirname, "../../..");

const compile = (yaml: string): CompiledGraph => {
  const parsed = parseWorkflow(yaml);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  const { graph, diagnostics } = compileWorkflow(parsed.workflow);
  if (graph === null) throw new Error(JSON.stringify(diagnostics));
  return graph;
};

const workflow = (nodes: string[], edges: string[], extra: string[] = []) =>
  compile(
    [
      "schemaVersion: 1",
      "name: t",
      ...extra,
      "nodes:",
      ...nodes.map(n => `  ${n}`),
      "edges:",
      ...edges.map(e => `  - ${e}`),
    ].join("\n"),
  );

type Script = Record<string, Partial<NodeResult>[]>;

/** An executor that answers each node's nth run with `script[id][n - 1]`. */
const scripted = (
  script: Script,
  cost = 0,
): { executor: NodeExecutor; ran: string[] } => {
  const ran: string[] = [];
  const executor: NodeExecutor = context => {
    ran.push(context.id);
    const answers = script[context.id] ?? [];
    const answer = answers[context.round - 1] ?? answers.at(-1) ?? {};
    const output = answer.output ?? { status: "pass", summary: "ok" };
    return Promise.resolve({
      ok: output["status"] !== "fail",
      output,
      usage: {
        costUsd: cost,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        turns: 1,
        durationMs: 0,
      },
      ...answer,
    });
  };
  return { executor, ran };
};

const allTypes = (executor: NodeExecutor): NodeExecutors => ({
  "claude.leader": executor,
  "claude.worker": executor,
  "tool.gh": executor,
  "tool.shell": executor,
  "human.gate": executor,
});

const answering = (choice: string) => {
  const asked: string[] = [];
  const human: HumanChannel = {
    ask: ({ question }) => {
      asked.push(question);
      return Promise.resolve(choice);
    },
    permit: () => Promise.resolve({ allow: true }),
  };
  return { human, asked };
};

const run = async (
  graph: CompiledGraph,
  executors: NodeExecutors,
  human: HumanChannel = answering("stop").human,
) => {
  const events: RunEvent[] = [];
  const handle = startRun({
    graph,
    inputs: { feature: "dark mode" },
    cwd: repoRoot,
    executors,
    human,
    runId: "r1",
    onEvent: event => {
      events.push(event);
    },
  });
  const result = await handle.done;
  const of = (type: RunEvent["type"]) => events.filter(e => e.type === type);
  return { result, events, of };
};

const ids = (events: RunEvent[]) =>
  events.map(e => ("id" in e ? e.id : e.type));

const waiting: NodeExecutor = ({ signal }) =>
  new Promise(resolve => {
    signal.addEventListener("abort", () => {
      resolve({ ok: false, output: {}, error: "aborted" });
    });
  });

const pass = { output: { status: "pass", summary: "ok" } };
const changes = { output: { status: "changes_requested", summary: "fix" } };

describe("the scheduler", () => {
  const factory = compile(
    readFileSync(
      path.join(repoRoot, "examples/software-factory.ork.yaml"),
      "utf8",
    ),
  );

  it("runs the software-factory example with one fix round", async () => {
    const { executor, ran } = scripted({
      security: [changes, pass],
      approver: [
        { output: { status: "pass", summary: "ok", verdict: "approve" } },
      ],
      ship: [{ output: { choice: "open", answeredBy: "terminal" } }],
      push: [{ output: { exitCode: 0, stdout: "", stderr: "" }, ok: true }],
      pr: [{ output: { exitCode: 0, stdout: "", stderr: "" }, ok: true }],
    });
    const { result, of } = await run(factory, allTypes(executor));

    expect(result.status).toBe("succeeded");
    expect(ran.filter(id => id === "builder")).toHaveLength(2);
    expect(ran.slice(-4)).toEqual(["approver", "ship", "push", "pr"]);
    expect(ran).not.toContain("escalated");
    // Round 1 skips the approver's branch; round 2 runs it, skipping
    // `escalated`.
    expect(ids(of("node.skipped"))).toEqual([
      "approver",
      "ship",
      "escalated",
      "push",
      "pr",
      "escalated",
    ]);
    expect(result.nodes.find(n => n.id === "reviews")?.runs).toBe(2);
  });

  it("asks when a loop runs out of rounds, and stops on the recommended answer", async () => {
    const { executor, ran } = scripted({ security: [changes] });
    const { human, asked } = answering("stop");
    const { result, of } = await run(factory, allTypes(executor), human);

    expect(ran.filter(id => id === "builder")).toHaveLength(3);
    expect(of("loop.exhausted")).toEqual([
      { type: "loop.exhausted", from: "reviews", to: "builder", maxRounds: 2 },
    ]);
    expect(asked).toEqual([
      "The loop reviews -> builder used all 2 of its rounds. What now?",
    ]);
    expect(result.status).toBe("failed");
    expect(result.reasons).toEqual([
      "the loop reviews -> builder ran out of rounds",
    ]);
  });

  it("allows one more round when asked to", async () => {
    const { executor, ran } = scripted({
      security: [changes, changes, changes, pass],
    });
    const { result } = await run(
      factory,
      allTypes(executor),
      answering("again").human,
    );
    expect(ran.filter(id => id === "builder")).toHaveLength(4);
    expect(result.status).toBe("succeeded");
  });

  it("fails the run when a failed node has no edge to take", async () => {
    const graph = workflow(
      ["a: { type: claude.worker }", "b: { type: claude.worker }"],
      ["a -> b"],
    );
    const { executor, ran } = scripted({
      a: [{ output: { status: "fail", summary: "no" }, error: "it broke" }],
    });
    const { result } = await run(graph, allTypes(executor));
    expect(ran).toEqual(["a"]);
    expect(result).toMatchObject({
      status: "failed",
      reasons: ["a: it broke"],
    });
  });

  it("routes a failure along a `when: status == 'fail'` edge", async () => {
    const graph = workflow(
      [
        "a: { type: claude.worker }",
        "ok: { type: claude.worker }",
        "fix: { type: claude.worker }",
      ],
      ["a -> ok", "{ from: a, to: fix, when: \"status == 'fail'\" }"],
    );
    const { executor, ran } = scripted({
      a: [{ output: { status: "fail", summary: "no" } }],
    });
    const { result } = await run(graph, allTypes(executor));
    expect(ran).toEqual(["a", "fix"]);
    expect(result.status).toBe("succeeded");
  });
});

describe("joins and routers", () => {
  const nodes = [
    "start: { type: control.split }",
    "a: { type: claude.worker }",
    "b: { type: claude.worker }",
    "c: { type: claude.worker }",
  ];

  it("a router in `first` mode takes one edge; the join does not wait for the others", async () => {
    const graph = workflow(
      [
        ...nodes.slice(0, 3),
        "route: { type: control.router }",
        "j: { type: control.join }",
        "after: { type: claude.worker }",
      ],
      [
        "start -> route",
        '{ from: route, to: a, when: "true" }',
        '{ from: route, to: b, when: "true" }',
        "a, b -> j",
        "j -> after",
      ],
    );
    const { executor, ran } = scripted({});
    const { result, of } = await run(graph, allTypes(executor));
    expect(ran).toEqual(["a", "after"]);
    expect(ids(of("node.skipped"))).toEqual(["b"]);
    expect(result.nodes.find(n => n.id === "j")?.output).toEqual({
      statuses: ["pass"],
      results: { a: { status: "pass", summary: "ok" } },
      count: 1,
    });
  });

  it("`any` fires once on the first input; `n` waits for n", async () => {
    const any = workflow(
      [
        ...nodes,
        "j: { type: control.join, mode: any }",
        "after: { type: claude.worker }",
      ],
      ["start -> a, b, c", "a, b, c -> j", "j -> after"],
    );
    const first = scripted({});
    await run(any, allTypes(first.executor));
    expect(first.ran.filter(id => id === "after")).toHaveLength(1);

    const two = workflow(
      [
        ...nodes,
        "j: { type: control.join, mode: n, n: 2 }",
        "after: { type: claude.worker }",
      ],
      ["start -> a, b, c", "a, b, c -> j", "j -> after"],
    );
    const second = scripted({
      c: [{ output: { status: "fail", summary: "no" } }],
    });
    const { result } = await run(two, allTypes(second.executor));
    expect(result.nodes.find(n => n.id === "j")?.output).toMatchObject({
      count: 2,
    });
    expect(second.ran.filter(id => id === "after")).toHaveLength(1);
  });
});

describe("limits", () => {
  it("stops starting sessions when the run's budget is spent", async () => {
    const graph = workflow(
      ["a: { type: claude.worker }", "b: { type: claude.worker }"],
      ["a -> b"],
      ["limits: { budgetUsd: 1 }"],
    );
    const { executor, ran } = scripted({}, 1.5);
    const { result } = await run(graph, allTypes(executor));
    expect(ran).toEqual(["a"]);
    expect(result).toMatchObject({
      status: "budget_exhausted",
      costUsd: 1.5,
      reasons: ["the run's budget of $1 is spent"],
    });
  });

  it("passes what is left of the budget to each node", async () => {
    const graph = workflow(
      ["a: { type: claude.worker }", "b: { type: claude.worker }"],
      ["a -> b"],
      ["limits: { budgetUsd: 2 }"],
    );
    const seen: (number | undefined)[] = [];
    const { executor } = scripted({}, 0.5);
    const watching: NodeExecutor = context => {
      seen.push(context.budgetLeftUsd);
      return executor(context);
    };
    await run(graph, allTypes(watching));
    expect(seen).toEqual([2, 1.5]);
  });

  it("runs at most `limits.concurrency` sessions at once", async () => {
    const graph = workflow(
      [
        "start: { type: control.split }",
        ...["a", "b", "c", "d"].map(id => `${id}: { type: claude.worker }`),
      ],
      ["start -> a, b, c, d"],
      ["limits: { concurrency: 2 }"],
    );
    let running = 0;
    let peak = 0;
    const slow: NodeExecutor = async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise(resolve => {
        setTimeout(resolve, 5);
      });
      running -= 1;
      return { ok: true, output: { status: "pass", summary: "ok" } };
    };
    const { result } = await run(graph, allTypes(slow));
    expect(result.status).toBe("succeeded");
    expect(peak).toBe(2);
  });

  it("stops on interrupt and aborts running nodes", async () => {
    const graph = workflow(
      ["a: { type: claude.worker }", "b: { type: claude.worker }"],
      ["a -> b"],
    );
    const handle = startRun({
      graph,
      inputs: {},
      cwd: repoRoot,
      executors: allTypes(waiting),
      human: answering("stop").human,
      onEvent: () => {},
    });
    setTimeout(handle.interrupt, 5);
    const result = await handle.done;
    expect(result.status).toBe("interrupted");
    expect(result.nodes.map(n => n.id)).toEqual(["a"]);
  });
});
