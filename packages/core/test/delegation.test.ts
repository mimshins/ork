/**
 * @file Tests for ownership in the scheduler: a leader delegating to its
 *   children in parallel, spawning workers up to `maxWorkers`, what it may not
 *   delegate, the run's limits on children, and resuming a leader on re-entry.
 */

import { parseWorkflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import {
  compileWorkflow,
  type CompiledGraph,
  type Delegation,
  type NodeExecutor,
  type NodeResult,
  type Ownership,
  type RunEvent,
  startRun,
} from "../src/index.ts";

const compile = (lines: string[]): CompiledGraph => {
  const parsed = parseWorkflow(
    ["schemaVersion: 1", "name: t", ...lines].join("\n"),
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  const { graph, diagnostics } = compileWorkflow(parsed.workflow);
  if (graph === null) throw new Error(JSON.stringify(diagnostics));
  return graph;
};

const passing = (summary: string, cost = 0): NodeResult => ({
  ok: true,
  output: { status: "pass", summary },
  usage: {
    costUsd: cost,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    turns: 1,
    durationMs: 0,
  },
  sessionId: "session-1",
});

type Lead = (own: Ownership) => Promise<Delegation>;

/**
 * The leader runs `lead`; every other node echoes its brief after a tick, so
 * parallel children overlap.
 */
const team = (lead: Lead) => {
  const delegations: (Delegation | undefined)[] = [];
  let active = 0;
  let peak = 0;
  const executor: NodeExecutor = async context => {
    if (context.ownership !== undefined && context.brief === undefined) {
      delegations.push(await lead(context.ownership));
      return passing("led");
    }
    active += 1;
    peak = Math.max(peak, active);
    await new Promise(resolve => {
      setTimeout(resolve, 5);
    });
    active -= 1;
    return passing(`did: ${context.brief?.text ?? "flow"}`, 1);
  };
  return { executor, delegations, peak: () => peak };
};

const run = async (graph: CompiledGraph, executor: NodeExecutor) => {
  const events: RunEvent[] = [];
  const result = await startRun({
    graph,
    inputs: {},
    cwd: process.cwd(),
    executors: { "claude.leader": executor, "claude.worker": executor },
    human: {
      ask: () => Promise.resolve("stop"),
      permit: () => Promise.resolve({ allow: true }),
    },
    runId: "r1",
    onEvent: event => {
      events.push(event);
    },
  }).done;
  return { result, events };
};

const summaries = (delegation: Delegation | undefined) =>
  delegation?.reports.map(r => `${r.child}: ${String(r.output["summary"])}`);

/** `node.started` events, with the leader a delegated run is for. */
const started = (events: RunEvent[]): string[] =>
  events.flatMap(e =>
    e.type === "node.started"
      ? [`${e.id}${e.owner === undefined ? "" : ` for ${e.owner}`}`]
      : [],
  );

/** TEAM with other limits. */
const limited = (limits: string): CompiledGraph =>
  compile(TEAM.map(l => (l.startsWith("limits") ? `limits: ${limits}` : l)));

/** Review asks for another round once. */
const reviewOnce: NodeExecutor = context => {
  const again = context.id === "review" && context.round === 1;
  return Promise.resolve(passing(again ? "again" : "ok"));
};

const TEAM = [
  "limits: { concurrency: 1 }",
  "nodes:",
  "  lead: { type: claude.leader, maxWorkers: 2 }",
  "  fix: { type: claude.worker, parent: lead, description: fixes bugs }",
  "  check: { type: claude.worker, parent: lead }",
  "  after: { type: claude.worker }",
  "edges:",
  "  - lead -> after",
];

describe("delegation", () => {
  it("runs children for the leader on the slot it lends, without deadlock", async () => {
    const { executor, delegations } = team(own =>
      own.delegate([
        { child: "fix", brief: "fix the bug" },
        { child: "check", brief: "check it" },
      ]),
    );
    const { result, events } = await run(compile(TEAM), executor);

    expect(result.status).toBe("succeeded");
    expect(summaries(delegations[0])).toEqual([
      "fix: did: fix the bug",
      "check: did: check it",
    ]);
    expect(started(events)).toEqual([
      "lead",
      "fix for lead",
      "check for lead",
      "after",
    ]);
    // A delegated run reports to its leader and takes no edges of its own.
    expect(result.nodes.map(n => n.id)).toEqual([
      "fix",
      "check",
      "lead",
      "after",
    ]);
    expect(result.costUsd).toBe(3);
  });

  it("runs the children of one call in parallel", async () => {
    const { executor, peak } = team(own =>
      own.delegate([
        { child: "fix", brief: "a" },
        { child: "check", brief: "b" },
      ]),
    );
    const graph = limited("{ concurrency: 2 }");
    expect((await run(graph, executor)).result.status).toBe("succeeded");
    // The leader's own slot goes to its children while it waits.
    expect(peak()).toBe(2);
  });

  it("refuses unknown and busy children, and spawns workers up to maxWorkers", async () => {
    const { executor, delegations } = team(async own => {
      delegations.push(
        await own.delegate([
          { child: "after", brief: "x" },
          { child: "fix", brief: "a" },
          { child: "fix", brief: "b" },
        ]),
      );
      return own.spawn([
        { template: "fix", brief: "one" },
        { template: "fix", brief: "two" },
        { template: "fix", brief: "three" },
        { template: "lead", brief: "no" },
      ]);
    });
    const { result } = await run(compile(TEAM), executor);

    const [first, second] = delegations;
    expect(first?.reports.map(r => [r.child, r.ok, r.error])).toEqual([
      ["after", false, "not one of your children (fix, check)"],
      ["fix", true, undefined],
      ["fix", false, "already running; use spawn_worker for another instance"],
    ]);
    expect(second?.reports.map(r => [r.child, r.ok, r.error])).toEqual([
      ["fix-2", true, undefined],
      ["fix-3", true, undefined],
      ["fix", false, "no workers left to spawn (maxWorkers: 2)"],
      ["lead", false, "not one of your child workers (fix, check)"],
    ]);
    expect(result.nodes.map(n => n.id)).toContain("fix-3");
  });

  it("does not start children once the run's budget is spent", async () => {
    const { executor, delegations } = team(async own => {
      await own.delegate([{ child: "fix", brief: "costs $1" }]);
      return own.delegate([{ child: "check", brief: "too late" }]);
    });
    const { result } = await run(limited("{ budgetUsd: 1 }"), executor);
    expect(delegations[0]?.reports[0]?.error).toBe(
      "not started: the run's budget of $1 is spent",
    );
    expect(result.status).toBe("budget_exhausted");
  });

  it("resumes a re-entered leader's session; workers start fresh", async () => {
    const graph = compile([
      "nodes:",
      "  plan: { type: claude.worker }",
      "  lead: { type: claude.leader }",
      "  review: { type: claude.worker }",
      "edges:",
      "  - plan -> lead",
      "  - lead -> review",
      "  - { from: review, to: lead, when: \"summary == 'again'\", maxRounds: 1 }",
    ]);
    const seen: string[] = [];
    const executor: NodeExecutor = context => {
      seen.push(
        `${context.id} ${String(context.round)} ${String(context.resume)}`,
      );
      return reviewOnce(context);
    };
    const { result } = await run(graph, executor);
    expect(result.status).toBe("succeeded");
    expect(seen).toEqual([
      "plan 1 undefined",
      "lead 1 undefined",
      "review 1 undefined",
      "lead 2 session-1",
      "review 2 undefined",
    ]);
  });
});
