/**
 * @file Tests that a reserve never ends a run (ADR-077): a node cut off at a
 *   cap other nodes' reserves shrank stops the run `budget_exhausted` only once
 *   the run's budget is spent; until then its `budget_limit` failure is its own
 *   and its edges act on it. Other limits stop the run as before.
 */

import { parseWorkflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import {
  compileWorkflow,
  type CompiledGraph,
  type NodeExecutor,
  type NodeExecutors,
  type NodeResult,
  type RunStatus,
  type SessionUsage,
  startRun,
} from "../src/index.ts";
import { createSpend, limitOf } from "../src/run/spending.ts";

/** `a` fails into `b` along a `status == 'fail'` edge, under `limits`. */
const failureEdge = (limits: string): CompiledGraph => {
  const parsed = parseWorkflow(
    [
      "schemaVersion: 1",
      "name: t",
      `limits: ${limits}`,
      "nodes:",
      "  a: { type: agent.worker }",
      "  b: { type: agent.worker }",
      "edges:",
      "  - { from: a, to: b, when: \"status == 'fail'\" }",
    ].join("\n"),
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  const { graph, diagnostics } = compileWorkflow(parsed.workflow);
  if (graph === null) throw new Error(JSON.stringify(diagnostics));
  return graph;
};

const spending = (costUsd: number, inputTokens: number): SessionUsage => ({
  costUsd,
  inputTokens,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  turns: 1,
  durationMs: 0,
});

/** `a` ends as `cut`, with `usage`; every other node passes. */
const cutOff = (
  cut: Partial<NodeResult>,
  usage: SessionUsage,
): { executors: NodeExecutors; ran: string[] } => {
  const ran: string[] = [];
  const executor: NodeExecutor = ({ id }) => {
    ran.push(id);
    const passes = { ok: true, output: { status: "pass", summary: "ok" } };
    const fails = {
      ok: false,
      output: { status: "fail", summary: "capped" },
      error: "capped",
      ...cut,
    };
    return Promise.resolve({ ...(id === "a" ? fails : passes), usage });
  };
  return {
    executors: { "agent.worker": executor, "agent.leader": executor },
    ran,
  };
};

const run = (graph: CompiledGraph, executors: NodeExecutors) =>
  startRun({
    graph,
    inputs: {},
    cwd: process.cwd(),
    executors,
    human: {
      ask: () => Promise.resolve("stop"),
      permit: () => Promise.resolve({ allow: true }),
    },
    runId: "r1",
    onEvent: () => {
      // These tests read the run's result, not its events.
    },
  }).done;

const blamesRun = (reason: string): Partial<NodeResult> => ({
  limited: reason,
  stopsAs: "budget_exhausted",
});

const units = [
  {
    unit: "dollars",
    limits: "{ budgetUsd: 20 }",
    blame: "the run's budget of $20 is spent",
    under: spending(1, 0),
    spent: spending(20, 0),
  },
  {
    unit: "tokens",
    limits: "{ budgetTokens: 1000 }",
    blame: "the run's budget of 1000 tokens is spent",
    under: spending(0, 10),
    spent: spending(0, 1000),
  },
];

describe("a node that blames the run for its cap", () => {
  it.each(units)(
    "in $unit, while the run is not spent, fails as its own and its edges act",
    async ({ limits, blame, under }) => {
      const { executors, ran } = cutOff(blamesRun(blame), under);
      const result = await run(failureEdge(limits), executors);
      expect(ran).toEqual(["a", "b"]);
      expect(result).toMatchObject({
        status: "succeeded",
        failuresHandled: 1,
      });
    },
  );

  it.each(units)(
    "in $unit, once the run is spent, ends it budget_exhausted and no edge acts",
    async ({ limits, blame, spent }) => {
      const { executors, ran } = cutOff(blamesRun(blame), spent);
      const result = await run(failureEdge(limits), executors);
      expect(ran).toEqual(["a"]);
      expect(result).toMatchObject({
        status: "budget_exhausted",
        reasons: [blame],
      });
    },
  );
});

/**
 * `a` reports its session's `usage` through its context, as a driver does, then
 * ends blaming the run with the same session's result.
 */
const reportsThenBlames = (blame: string, usage: SessionUsage) => {
  const { executors, ran } = cutOff(
    { ...blamesRun(blame), sessionId: "s" },
    usage,
  );
  const worker = executors["agent.worker"];
  const reporting: NodeExecutor = context => {
    context.emit({
      type: "session.finished",
      outcome: {
        subtype: "error_max_budget_usd",
        sessionId: "s",
        report: null,
        text: "",
        usage,
        errors: [],
      },
    });
    return worker === undefined
      ? Promise.reject(new Error("no worker"))
      : worker(context);
  };
  return { executors: { "agent.worker": reporting }, ran };
};

describe("the scheduler reads whether the run is spent", () => {
  it.each([
    ["dollars", "{ budgetUsd: 20 }", spending(12, 0)],
    ["tokens", "{ budgetTokens: 20 }", spending(0, 12)],
  ])(
    "in %s only after the node settled, so its cost counts once",
    async (_unit, limits, usage) => {
      // Before it settles, 12 sits in flight and in what was spent: 24 of 20.
      const { executors, ran } = reportsThenBlames("spent", usage);
      const result = await run(failureEdge(limits), executors);
      expect(ran).toEqual(["a", "b"]);
      expect(result.status).toBe("succeeded");
    },
  );
});

/** A `stop` that keeps what it was told in `seen`. */
const stops = () => {
  const seen: [RunStatus, string][] = [];
  const stop = (status: RunStatus, reason: string) => {
    seen.push([status, reason]);
  };
  return { seen, stop };
};

describe("limitOf", () => {
  const blamed: NodeResult = {
    ok: false,
    output: {},
    ...blamesRun("the run's budget of $20 is spent"),
  };

  it("gives back a plain failure, without limited or stopsAs, while the run is not spent", () => {
    const { seen, stop } = stops();
    const result = limitOf(blamed, () => null, stop);
    expect(result).not.toHaveProperty("limited");
    expect(result).not.toHaveProperty("stopsAs");
    expect(seen).toEqual([]);
  });

  it("stops the run for what is spent, a quota included", () => {
    const { seen, stop } = stops();
    limitOf(
      blamed,
      () => ({ status: "quota_exhausted", reason: "the day quota is spent" }),
      stop,
    );
    expect(seen).toEqual([["quota_exhausted", "the day quota is spent"]]);
  });
});

describe("other limits stop the run as before", () => {
  it.each<[string, Partial<NodeResult>, RunStatus]>([
    ["a quota", { limited: "the day quota is spent" }, "quota_exhausted"],
    [
      "a failed fan-out",
      { limited: "an item failed", stopsAs: "failed" },
      "failed",
    ],
  ])("%s", async (_name, cut, status) => {
    const { executors, ran } = cutOff(cut, spending(1, 10));
    const result = await run(failureEdge("{ budgetUsd: 20 }"), executors);
    expect(ran).toEqual(["a"]);
    expect(result.status).toBe(status);
  });
});

describe("spentIn", () => {
  it("is true per unit once what sessions spent reaches the budget, reserves not counted", () => {
    const spend = createSpend(2, undefined, undefined, 100);
    spend.reserve("b", 1.5, true);
    spend.report("a", "s", 1, 10);
    expect([spend.spentIn("usd"), spend.spentIn("tokens")]).toEqual([
      false,
      false,
    ]);
    spend.report("a", "s", 2, 0);
    expect([spend.spentIn("usd"), spend.spentIn("tokens")]).toEqual([
      true,
      false,
    ]);
    expect(
      createSpend(undefined, undefined, undefined, 100).spentIn("usd"),
    ).toBe(false);
  });
});
