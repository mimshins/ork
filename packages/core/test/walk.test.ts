/**
 * @file Tests for the walk (RFC-009): what it finds, what it refuses to claim,
 *   and how it treats loops, watches, gates and values, on every example too.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { parseWorkflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import {
  type CompiledGraph,
  compileWorkflow,
  type RunHandle,
  stuckReason,
  walkChecks,
  walkSummary,
  walkWorkflow,
  type WalkResult,
} from "../src/index.ts";
import { explore } from "./fixtures/walk-fuzz.ts";

const examples = path.resolve(import.meta.dirname, "../../../examples");

const compile = (yaml: string, dir = examples): CompiledGraph => {
  const parsed = parseWorkflow(yaml);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  const { graph, diagnostics } = compileWorkflow(parsed.workflow, {
    workflowDir: dir,
    projectRoot: dir,
  });
  if (graph === null) throw new Error(JSON.stringify(diagnostics));
  return graph;
};

const graphOf = (
  nodes: string[],
  edges: string[],
  extra: string[] = [],
): CompiledGraph =>
  compile(
    [
      "schemaVersion: 1",
      "name: t",
      ...extra,
      "nodes:",
      ...nodes.map(node => `  ${node}`),
      ...(edges.length === 0
        ? []
        : ["edges:", ...edges.map(edge => `  - ${edge}`)]),
    ].join("\n"),
  );

const CLAUDE = "{ type: agent.worker, prompt: x }";
const SHELL = '{ type: tool.shell, command: "true", allow: ["true"] }';
const ROUTER = "{ type: control.router }";

const found = ({ findings }: WalkResult): string[] =>
  findings.map(({ code, path: where }) => `${code} ${where.join(".")}`);

/** Whether a node ran on some path. */
const ran = (result: WalkResult): ((name: string) => boolean) => {
  const everywhere = result.endings.map(({ notRun }) => new Set(notRun));
  return (name: string) => everywhere.some(set => !set.has(name));
};

const WATCHED = [
  "ci: { type: tool.shell, command: 'true', allow: ['true'],",
  "output: { format: json, schema: { state: [pending, done] } },",
  "watch: { every: 30s, until: \"json.state != 'pending'\", timeout: 1h } }",
].join(" ");

/** A chain of splits, each feeding the next twice, with no join to merge them. */
const diamonds = (count: number): CompiledGraph => {
  const steps = Array.from({ length: count }, (_, at) => at);
  return graphOf(
    [
      "s0: { type: control.split }",
      ...steps.flatMap(at => [
        `a${String(at)}: { type: control.split }`,
        `b${String(at)}: { type: control.split }`,
        `s${String(at + 1)}: { type: control.split }`,
      ]),
    ],
    steps.flatMap(at => [
      `s${String(at)} -> a${String(at)}, b${String(at)}`,
      `a${String(at)} -> s${String(at + 1)}`,
      `b${String(at)} -> s${String(at + 1)}`,
    ]),
  );
};

const endedOnPending = (choice: string): boolean =>
  choice.includes("pending") && !choice.includes("timed out");

const exampleFiles = readdirSync(examples).filter(file =>
  file.endsWith(".ork.yaml"),
);

describe("what a walk finds", () => {
  it("finds what a condition that's always false strands", async () => {
    const graph = graphOf(
      [`a: ${CLAUDE}`, `b: ${CLAUDE}`, `c: ${CLAUDE}`],
      ['{ from: a, to: b, when: "false" }', "b -> c"],
    );
    const result = await walkWorkflow(graph);
    expect(found(result)).toEqual([
      "walk.never-runs nodes.b",
      "walk.never-runs nodes.c",
    ]);
  });

  it("finds a join a first-match router can't fill", async () => {
    const graph = graphOf(
      [
        `r: ${ROUTER}`,
        `x: ${CLAUDE}`,
        `y: ${CLAUDE}`,
        "j: { type: control.join, mode: n, n: 2 }",
        `after: ${CLAUDE}`,
      ],
      ["r -> x, y", "x, y -> j", "j -> after"],
    );
    const result = await walkWorkflow(graph);
    expect(found(result)).toEqual([
      "walk.never-runs nodes.y",
      "walk.never-runs nodes.j",
      "walk.never-runs nodes.after",
    ]);
  });

  it("finds a handler for a failure its source can't reach", async () => {
    const graph = graphOf(
      [`a: ${CLAUDE}`, `r: ${ROUTER}`, `x: ${CLAUDE}`, `y: ${CLAUDE}`],
      [
        "a -> r",
        "{ from: r, to: x, when: \"status == 'pass'\" }",
        "{ from: r, to: y, when: \"status == 'fail'\" }",
      ],
    );
    const result = await walkWorkflow(graph);
    // A failed `a` takes no plain edge, so the router never sees `fail`.
    expect(found(result)).toEqual(["walk.never-runs nodes.y"]);
  });

  it("finds a loop only its rounds can end", async () => {
    const graph = graphOf(
      [`a: ${SHELL}`, `b: ${SHELL}`],
      ["a -> b", '{ from: b, to: a, when: "exitCode != 99", maxRounds: 2 }'],
    );
    const result = await walkWorkflow(graph);
    expect(found(result)).toEqual(["walk.only-rounds edges.1"]);
  });

  it("leaves a loop with no condition to the compiler", async () => {
    const graph = graphOf(
      [`a: ${CLAUDE}`, `b: ${CLAUDE}`],
      ["a -> b", "{ from: b, to: a, maxRounds: 2 }"],
    );
    expect(found(await walkWorkflow(graph))).toEqual([]);
  });

  it("says nothing of a loop with a way out", async () => {
    const graph = graphOf(
      [`a: ${CLAUDE}`, `b: ${CLAUDE}`],
      [
        "a -> b",
        "{ from: b, to: a, when: \"status == 'changes_requested'\", maxRounds: 2 }",
      ],
    );
    expect(found(await walkWorkflow(graph))).toEqual([]);
  });
});

describe("what a walk won't claim", () => {
  const stranded = [`a: ${CLAUDE}`, `b: ${CLAUDE}`];
  const off = '{ from: a, to: b, when: "false" }';

  it("claims nothing is absent once it stops at its cap", async () => {
    const graph = graphOf(stranded, [off]);
    const result = await walkWorkflow(graph, { cap: 1 });
    expect(result.complete).toBe(false);
    expect(result.paths).toBe(1);
    expect(found(result)).toEqual([]);
  });

  it("claims nothing is absent once it runs out of time", async () => {
    const graph = graphOf(stranded, [off]);
    const result = await walkWorkflow(graph, { maxMs: 0 });
    expect(result.complete).toBe(false);
    expect(result.paths).toBe(1);
    expect(found(result)).toEqual([]);
  });

  it("doesn't report what's behind a condition on an input", async () => {
    const graph = graphOf(
      [...stranded, `c: ${CLAUDE}`],
      ["{ from: a, to: b, when: \"inputs.mode == 'fast'\" }", "b -> c"],
      ["inputs:", "  mode: { type: string }"],
    );
    expect(found(await walkWorkflow(graph))).toEqual([]);
  });

  it("doesn't report what two fields together decide", async () => {
    const graph = graphOf(
      [
        "a: { type: agent.worker, prompt: x, output: { schema: { kind: [one, two] } } }",
        `b: ${CLAUDE}`,
      ],
      ["{ from: a, to: b, when: \"!ok && kind == 'one'\" }"],
    );
    expect(found(await walkWorkflow(graph))).toEqual([]);
  });

  it("doesn't report a first-match router's other edges", async () => {
    const graph = graphOf(
      [`r: ${ROUTER}`, `x: ${CLAUDE}`, `y: ${CLAUDE}`],
      ["{ from: r, to: x, when: \"inputs.mode != 'fast'\" }", "r -> y"],
      ["inputs:", "  mode: { type: string }"],
    );
    expect(found(await walkWorkflow(graph))).toEqual([]);
  });

  it("doesn't report owned nodes, or what's behind them", async () => {
    const graph = graphOf(
      [
        "lead: { type: agent.leader, prompt: x }",
        "kid: { type: agent.worker, prompt: x, parent: lead }",
        `after: ${CLAUDE}`,
      ],
      ["kid -> after"],
    );
    const result = await walkWorkflow(graph);
    expect(found(result)).toEqual([]);
    expect(result.endings.flatMap(({ notRun }) => notRun)).not.toContain("kid");
  });

  it.each([
    [
      "a condition reading an owned child",
      [
        "lead: { type: agent.leader, prompt: x }",
        "child: { type: agent.worker, prompt: x, parent: lead }",
        `t: ${CLAUDE}`,
      ],
      ["{ from: lead, to: t, when: \"nodes.child.output.status == 'pass'\" }"],
    ],
    [
      "a loop that a child's report would end",
      [
        "lead: { type: agent.leader, prompt: x }",
        "child: { type: agent.worker, prompt: x, parent: lead }",
        `t: ${CLAUDE}`,
      ],
      [
        "{ from: lead, to: lead, when: \"nodes.child.output.status != 'pass'\", maxRounds: 2 }",
        "{ from: lead, to: t, when: \"nodes.child.output.status == 'pass'\" }",
      ],
    ],
    [
      "an input beside a status on a first-match router",
      [
        `build: ${CLAUDE}`,
        `r: ${ROUTER}`,
        `stage: ${CLAUDE}`,
        `prod: ${CLAUDE}`,
      ],
      [
        "build -> r",
        "{ from: r, to: stage, when: \"status == 'pass' && inputs.env != 'prod'\" }",
        "{ from: r, to: prod, when: \"status == 'pass'\" }",
      ],
    ],
    [
      "a join an input could fill",
      [
        "a: { type: tool.shell, command: 'true', allow: ['true'], output: { format: json } }",
        `r1: ${ROUTER}`,
        `r2: ${ROUTER}`,
        "j: { type: control.join, mode: n, n: 2 }",
        `after: ${CLAUDE}`,
      ],
      [
        "{ from: a, to: r1, when: \"json.v == 'a'\" }",
        "{ from: a, to: r2, when: \"json.v == 'b' || inputs.env == 'go'\" }",
        "r1, r2 -> j",
        "j -> after",
      ],
    ],
    [
      "a read of a node that may finish first",
      [`b: ${CLAUDE}`, `p: ${CLAUDE}`, `x: ${CLAUDE}`, `t: ${CLAUDE}`],
      [
        "p -> x",
        "{ from: b, to: t, when: \"nodes.x.output.status == 'done'\" }",
      ],
    ],
    [
      "a gate's failure, which isn't tried",
      [
        'g: { type: human.gate, question: q, options: ["yes", "no"] }',
        `h: ${CLAUDE}`,
      ],
      ['{ from: g, to: h, when: "!ok" }'],
    ],
    [
      "stages a loop reaches in rounds it cuts",
      [`drive: ${CLAUDE}`, `s1: ${CLAUDE}`, `s2: ${CLAUDE}`, `s3: ${CLAUDE}`],
      [
        "{ from: drive, to: s1, when: \"status == 'pass'\" }",
        "{ from: drive, to: s2, when: \"nodes.s1.output.status == 'pass'\" }",
        "{ from: drive, to: s3, when: \"nodes.s2.output.status == 'pass'\" }",
        "{ from: drive, to: drive, when: \"status == 'changes_requested'\", maxRounds: 10 }",
      ],
    ],
    [
      "a join a loop feeds across rounds",
      [
        "c: { type: human.gate, question: q, options: [x, y] }",
        `a: ${CLAUDE}`,
        `p: ${CLAUDE}`,
        `u: ${CLAUDE}`,
        "j: { type: control.join, mode: n, n: 2 }",
        `t: ${CLAUDE}`,
      ],
      [
        "c -> a",
        "{ from: a, to: p, when: \"status == 'changes_requested'\" }",
        "{ from: p, to: a, maxRounds: 2 }",
        "{ from: a, to: u, when: \"status == 'done'\" }",
        "u -> j",
        "{ from: c, to: j, when: \"choice == 'y'\" }",
        "j -> t",
      ],
    ],
    [
      "a handler for a wait that ran out",
      [WATCHED, `giveup: ${CLAUDE}`, `go: ${CLAUDE}`],
      [
        "{ from: ci, to: giveup, when: \"json.state == 'pending'\" }",
        "{ from: ci, to: go, when: \"json.state == 'done'\" }",
      ],
    ],
    [
      "a join behind a node that runs twice with no loop",
      [
        "g: { type: human.gate, question: q, options: [a, b] }",
        `xb: ${CLAUDE}`,
        "s: { type: control.split }",
        `b: ${CLAUDE}`,
        `c: ${CLAUDE}`,
        `d: ${CLAUDE}`,
        `e: ${CLAUDE}`,
        `h: ${CLAUDE}`,
        "j: { type: control.join }",
        `z: ${CLAUDE}`,
      ],
      [
        "{ from: g, to: xb, when: \"choice == 'b'\" }",
        "g -> s",
        '{ from: xb, to: j, when: "true" }',
        "s -> b, c",
        "b -> d",
        "c -> d",
        "d -> e",
        '{ from: d, to: h, when: "!ok" }',
        '{ from: e, to: j, when: "true" }',
        '{ from: h, to: j, when: "true" }',
        '{ from: j, to: z, when: "len(statuses) == 3" }',
      ],
    ],
    [
      "a gate's answer read through a router",
      [
        "g: { type: human.gate, question: q, options: [a, b] }",
        `r: ${ROUTER}`,
        `n: ${CLAUDE}`,
        `h: ${CLAUDE}`,
      ],
      [
        '{ from: g, to: r, when: "true" }',
        "{ from: r, to: n, when: \"choice == 'a' || choice == 'b'\" }",
        "{ from: r, to: h, when: \"choice != 'a' && choice != 'b'\" }",
      ],
    ],
    [
      "a field a node declares called ok",
      [
        "a: { type: agent.worker, prompt: x, output: { schema: { ok: boolean } } }",
        `b: ${CLAUDE}`,
      ],
      ['{ from: a, to: a, maxRounds: 2, when: "ok" }', "a -> b"],
    ],
    [
      "a wait an input can end",
      [
        "w: { type: tool.shell, command: 'true', allow: ['true'], output: { format: json, schema: { state: [go, pending] } }, watch: { every: 30s, until: \"inputs.env == 'prod' || json.state == 'go'\", timeout: 1h } }",
        `r: ${ROUTER}`,
        `h: ${CLAUDE}`,
      ],
      ["w -> r", "{ from: r, to: h, when: \"json.state == 'pending'\" }"],
    ],
  ])("makes no claim about %s", async (_, nodes, edges) => {
    const graph = graphOf(nodes, edges, [
      "inputs:",
      "  env: { type: string, default: dev }",
    ]);
    expect(found(await walkWorkflow(graph))).toEqual([]);
  });

  it.each([
    [
      "a loop that a first round can leave",
      [
        `plan: ${CLAUDE}`,
        `impl: ${CLAUDE}`,
        "review: { type: agent.worker, prompt: x, output: { schema: { verdict: [approved, rework, replan] } } }",
        `ship: ${CLAUDE}`,
      ],
      [
        "plan -> impl",
        "impl -> review",
        "{ from: review, to: ship, when: \"verdict == 'approved'\" }",
        "{ from: review, to: impl, maxRounds: 3, when: \"verdict == 'rework'\" }",
        "{ from: review, to: plan, maxRounds: 2, when: \"verdict == 'replan'\" }",
      ],
    ],
    [
      "a loop whose way out goes through a watch that may not end",
      [
        `impl: ${CLAUDE}`,
        `review: ${CLAUDE}`,
        "ci: { type: tool.shell, command: 'true', allow: ['true'], output: { format: json, schema: { head: string } }, watch: { every: 30s, until: 'json.head == inputs.env', timeout: 1h } }",
      ],
      [
        "impl -> review",
        "{ from: review, to: ci, when: \"status != 'changes_requested'\" }",
        "{ from: review, to: impl, maxRounds: 3, when: \"status == 'changes_requested'\" }",
      ],
    ],
    [
      "what an any join reports, which depends on what finished first",
      [
        "s: { type: control.split }",
        "a: { type: agent.worker, prompt: x, output: { schema: { status: [pass] } } }",
        "b: { type: agent.worker, prompt: x, output: { schema: { status: [done] } } }",
        "j: { type: control.join, mode: any }",
        `x: ${CLAUDE}`,
      ],
      [
        "s -> a, b",
        '{ from: a, to: j, when: "true" }',
        '{ from: b, to: j, when: "true" }',
        "{ from: j, to: x, when: \"any(statuses, 'done')\" }",
      ],
    ],
    [
      "a failed node that still carries a value",
      [
        "a: { type: agent.worker, prompt: x, output: { schema: { verdict: [keep, drop] } } }",
        `x: ${ROUTER}`,
        `y: ${ROUTER}`,
        "j: { type: control.join, mode: n, n: 2 }",
        `t: ${CLAUDE}`,
      ],
      [
        '{ from: a, to: x, when: "!ok" }',
        "{ from: a, to: y, when: \"verdict == 'keep'\" }",
        "x, y -> j",
        "j -> t",
      ],
    ],
    [
      "a gate someone stops, which has no choice",
      [
        "g: { type: human.gate, question: q, options: [a, b] }",
        `h: ${CLAUDE}`,
        `o: ${CLAUDE}`,
      ],
      [
        "{ from: g, to: o, when: \"choice == 'a'\" }",
        "{ from: g, to: h, when: \"choice != 'a' && choice != 'b'\" }",
      ],
    ],
    [
      "a null a list allows",
      [
        "a: { type: agent.worker, prompt: x, output: { schema: { verdict: [yes, ~] } } }",
        `h: ${CLAUDE}`,
      ],
      ['{ from: a, to: h, when: "verdict == null" }'],
    ],
    [
      "a watch no outcome tried could end",
      [
        "ci: { type: tool.shell, command: 'true', allow: ['true'], output: { format: json, schema: { head: string } }, watch: { every: 30s, until: 'json.head == inputs.env', timeout: 1h } }",
        `go: ${CLAUDE}`,
      ],
      ['{ from: ci, to: go, when: "ok" }'],
    ],
    [
      "values cut at the 32 ways",
      [
        "a: { type: agent.worker, prompt: x, output: { schema: { p: [a, b, c], q: [a, b, c], r: [a, b, c], s: [a, b, c] } } }",
        `t: ${CLAUDE}`,
        `u: ${CLAUDE}`,
      ],
      [
        "{ from: a, to: t, when: \"p == 'c'\" }",
        "{ from: a, to: u, when: \"q == 'a' && r == 'a' && s == 'a'\" }",
      ],
    ],
    [
      "a status that depends on what a call called",
      ["c: { type: workflow.call, workflow: other }", `t: ${CLAUDE}`],
      ["{ from: c, to: t, when: \"status == 'one' && status == 'two'\" }"],
    ],
  ])("makes no claim about %s", async (_, nodes, edges) => {
    const graph = graphOf(nodes, edges, [
      "limits: { budgetUsd: 1 }",
      "inputs:",
      "  env: { type: string, default: dev }",
    ]);
    expect(found(await walkWorkflow(graph))).toEqual([]);
  });

  it.each([
    [
      "a value a loop brings back to a router",
      "out",
      [
        "a: { type: tool.shell, command: 'true', allow: ['true'], output: { format: json } }",
        `r: ${ROUTER}`,
        "b: { type: tool.shell, command: 'true', allow: ['true'], output: { format: json } }",
        `out: ${CLAUDE}`,
      ],
      [
        "a -> r",
        "{ from: r, to: out, when: \"json.x == 'quit'\" }",
        "{ from: r, to: b, when: \"json.x != 'quit'\" }",
        "{ from: b, to: r, maxRounds: 2 }",
      ],
    ],
    [
      "what a watch waits for, which no edge reads",
      "go",
      [
        "w: { type: tool.shell, command: 'true', allow: ['true'], output: { format: json }, watch: { every: 30s, until: \"json.s == 'ok'\", timeout: 1h } }",
        `go: ${CLAUDE}`,
      ],
      ["w -> go"],
    ],
    [
      "a value a call's status can have beyond its list",
      "t",
      ["c: { type: workflow.call, workflow: other }", `t: ${CLAUDE}`],
      ["{ from: c, to: t, when: \"status == 'custom'\" }"],
    ],
    [
      "what a join is asked of its inputs",
      "x",
      [
        "s: { type: control.split }",
        "a: { type: agent.worker, prompt: x, output: { schema: { status: [pass] } } }",
        `b: ${CLAUDE}`,
        "j: { type: control.join }",
        `x: ${CLAUDE}`,
      ],
      [
        "s -> a, b",
        "a, b -> j",
        "{ from: j, to: x, when: \"any(statuses, 'done')\" }",
      ],
    ],
    [
      "a session that ends with no report",
      "x",
      [
        "a: { type: agent.worker, prompt: x, output: { schema: { verdict: [yes, no] } } }",
        `x: ${CLAUDE}`,
      ],
      [
        "{ from: a, to: x, when: \"!ok && verdict != 'yes' && verdict != 'no'\" }",
      ],
    ],
    [
      "a tool whose JSON says it failed, on exit 0",
      "x",
      [
        "a: { type: tool.shell, command: 'true', allow: ['true'], output: { format: json, schema: { state: [ready, pending] } } }",
        `x: ${CLAUDE}`,
      ],
      ['{ from: a, to: x, when: "!ok && exitCode == 0" }'],
    ],
  ])("tries %s", async (_, target, nodes, edges) => {
    const result = await walkWorkflow(graphOf(nodes, edges));
    expect(ran(result)(target)).toBe(true);
  });

  it("makes no claim about a loop edge off a cycle, whose source another loop runs again", async () => {
    const graph = graphOf(
      [
        `n0: ${CLAUDE}`,
        "n1: { type: human.gate, question: q, options: [a, b] }",
        `n2: ${CLAUDE}`,
        `n3: ${CLAUDE}`,
        `n4: ${CLAUDE}`,
      ],
      [
        '{ from: n0, to: n1, when: "!ok" }',
        "{ from: n0, to: n2, when: \"status == 'fail'\" }",
        "{ from: n1, to: n3, when: \"choice != 'a'\" }",
        "{ from: n1, to: n4, when: \"choice == 'b'\" }",
        '{ from: n2, to: n1, maxRounds: 3, when: "ok" }',
        "{ from: n2, to: n2, maxRounds: 2, when: \"status != 'fail'\" }",
      ],
    );
    // `n2 -> n1` is on no cycle: how often it's crossed is up to `n2 -> n2`.
    expect(found(await walkWorkflow(graph))).not.toContain(
      "walk.only-rounds edges.4",
    );
  });

  it("judges layers of routers that feed each other in a moment", async () => {
    const layers = 60;
    const routers = Array.from({ length: layers }, (_, at) => [
      `x${String(at)}: ${ROUTER}`,
      `y${String(at)}: ${ROUTER}`,
    ]).flat();
    const links = Array.from({ length: layers - 1 }, (_, at) =>
      ["x", "y"].map(
        from =>
          `${from}${String(at)} -> x${String(at + 1)}, y${String(at + 1)}`,
      ),
    ).flat();
    const graph = graphOf(
      [`a: ${CLAUDE}`, ...routers, `z: ${CLAUDE}`],
      [
        "a -> x0, y0",
        ...links,
        `{ from: x${String(layers - 1)}, to: z, when: "status == 'pass'" }`,
      ],
    );
    // Each router reads through to every way back to `a`: 2 to the 60th, if
    // they weren't shared.
    expect((await walkWorkflow(graph)).complete).toBe(true);
  });

  it("stays within its time even inside one path", async () => {
    const result = await walkWorkflow(diamonds(30), { maxMs: 50 });
    expect(result.complete).toBe(false);
    expect(found(result)).toEqual([]);
  }, 5000);

  it("ends what a live owner would answer, with no owner live", async () => {
    const graph = graphOf(
      [
        "lead: { type: agent.leader, prompt: x }",
        "kid: { type: agent.worker, prompt: x, parent: lead }",
      ],
      [
        "lead -> kid",
        "{ from: kid, to: kid, when: \"status == 'changes_requested'\", maxRounds: 1 }",
      ],
    );
    const result = await walkWorkflow(graph);
    expect(result.complete).toBe(true);
    expect(found(result)).toEqual([]);
  });

  it("doesn't repeat what the compiler already said of a node", async () => {
    const graph = graphOf(stranded, [off]);
    const { diagnostics } = await walkChecks({
      graph,
      diagnostics: [
        {
          severity: "warning",
          code: "graph.unreachable",
          message: "`b` never runs",
          path: ["nodes", "b"],
        },
      ],
    });
    expect(diagnostics.map(({ code }) => code)).toEqual(["graph.unreachable"]);
  });

  it("says when a path never settles, and claims nothing else", async () => {
    const graph = graphOf(stranded, [off]);
    const stuck: RunHandle = {
      runId: "stuck",
      done: new Promise(() => {
        // Never settles.
      }),
      interrupt: () => {
        // Nothing to stop.
      },
      pause: () => false,
      proceed: () => false,
      stopNode: () => false,
      tell: () => null,
      receive: () => {
        // Nothing to receive.
      },
      notice: () => {
        // Nothing to tell.
      },
    };
    const result = await walkWorkflow(graph, {
      settleMs: 1,
      start: () => stuck,
    });
    expect(result.complete).toBe(false);
    expect(found(result)).toEqual(["walk.unfinished "]);
    expect(result.findings[0]?.message).toContain("a bug in Ork");
  });

  it("counts a path the scheduler left waiting as a bug, not an ending", async () => {
    const graph = graphOf(stranded, [off]);
    const reason = stuckReason([{ id: "b", waitingOn: ["a"] }]);
    const waiting: RunHandle = {
      runId: "waiting",
      done: Promise.resolve({
        runId: "waiting",
        status: "failed",
        costUsd: 0,
        nodes: [],
        reasons: [reason],
        worktrees: [],
      }),
      interrupt: () => {
        // Nothing to stop.
      },
      pause: () => false,
      proceed: () => false,
      stopNode: () => false,
      tell: () => null,
      receive: () => {
        // Nothing to receive.
      },
      notice: () => {
        // Nothing to tell.
      },
    };
    const result = await walkWorkflow(graph, { start: () => waiting });
    expect(result.complete).toBe(false);
    expect(result.endings).toEqual([]);
    expect(found(result)).toEqual(["walk.unfinished "]);
  });
});

/** Two builders, one chosen by an input, and a join that loops back. */
const twoBuilders = () =>
  graphOf(
    [
      "task: { type: tool.shell, command: 'true', allow: ['true'] }",
      `build: ${CLAUDE}`,
      `engine: ${CLAUDE}`,
      `review: ${CLAUDE}`,
      `a11y: ${CLAUDE}`,
      "reviews: { type: control.join, mode: all }",
      `docs: ${CLAUDE}`,
    ],
    [
      "{ from: task, to: build, when: 'ok && !inputs.engine' }",
      "{ from: task, to: engine, when: 'ok && inputs.engine' }",
      "build -> review",
      "engine -> review",
      "{ from: build, to: a11y, when: 'ok && inputs.ui' }",
      "{ from: engine, to: a11y, when: 'ok && inputs.ui' }",
      "review -> reviews",
      "a11y -> reviews",
      "{ from: reviews, to: build, when: \"!all(statuses, 'pass') && !inputs.engine\", maxRounds: 2 }",
      "{ from: reviews, to: engine, when: \"!all(statuses, 'pass') && inputs.engine\", maxRounds: 2 }",
      "{ from: reviews, to: docs, when: \"all(statuses, 'pass')\" }",
    ],
    [
      "inputs:",
      "  engine: { type: boolean, default: false }",
      "  ui: { type: boolean, default: false }",
    ],
  );

/** The endings that succeed without running `node`. */
const succeedingWithout = (result: WalkResult, node: string) =>
  result.endings.filter(
    ({ status, notRun }) => status === "succeeded" && notRun.includes(node),
  );

describe("rounds a branch doesn't run in", () => {
  it("lists no success that skips the end, but by going onward", async () => {
    const result = await walkWorkflow(twoBuilders());
    const skipping = succeedingWithout(result, "docs");

    expect(result.complete).toBe(true);
    expect(skipping.length).toBeGreaterThan(0);
    expect(
      skipping.filter(
        ({ choices }) => !choices.includes("reviews ran out of rounds: onward"),
      ),
    ).toEqual([]);
    expect(result.endings).toContainEqual(
      expect.objectContaining({
        status: "failed",
        notRun: ["engine", "a11y", "docs"],
        choices: [
          "review: status = changes_requested",
          "review, round 2: status = changes_requested",
          "reviews ran out of rounds: stop",
        ],
      }),
    );
  });
});

describe("how a walk goes", () => {
  it("tries each answer to a gate, and keeps none as a problem", async () => {
    const graph = graphOf(
      [
        "ask: { type: human.gate, question: Go?, options: [go, keep] }",
        `ship: ${CLAUDE}`,
      ],
      ["{ from: ask, to: ship, when: \"choice == 'go'\" }"],
    );
    const result = await walkWorkflow(graph);
    expect(found(result)).toEqual([]);
    expect(result.endings).toContainEqual({
      status: "succeeded",
      notRun: ["ship"],
      choices: ["ask: choice = keep"],
      paths: 1,
    });
  });

  it("tries each answer when a loop runs out", async () => {
    const graph = graphOf(
      [`a: ${SHELL}`, `after: ${SHELL}`],
      [
        '{ from: a, to: a, when: "exitCode == 0", maxRounds: 1 }',
        "{ from: a, to: after, when: 'exitCode == 0' }",
      ],
    );
    const result = await walkWorkflow(graph);
    const choices = result.endings.flatMap(ending => ending.choices);
    expect(result.complete).toBe(true);
    expect(ran(result)("after")).toBe(true);
    expect(choices.some(said => said.endsWith(": stop"))).toBe(true);
  });

  it("isn't slowed by a large maxRounds", async () => {
    const graph = graphOf(
      [`a: ${SHELL}`, `b: ${SHELL}`],
      ["a -> b", "{ from: b, to: a, maxRounds: 100000 }"],
    );
    const result = await walkWorkflow(graph);
    expect(result.complete).toBe(true);
    expect(result.paths).toBeLessThan(50);
  });

  it("walks a watched node only to the ends a wait can have", async () => {
    const graph = graphOf(
      [WATCHED, `waiting: ${CLAUDE}`, `finished: ${CLAUDE}`],
      [
        "{ from: ci, to: waiting, when: \"json.state == 'pending'\" }",
        "{ from: ci, to: finished, when: \"json.state == 'done'\" }",
      ],
    );
    const result = await walkWorkflow(graph);
    const said = result.endings.flatMap(({ choices }) => choices);
    // A wait can't run out on a look its condition holds for.
    expect(said).not.toContain("ci: timed out, json.state = done");
    // It only says `pending` by running out of time, and that's a failure.
    expect(said).toContain("ci: timed out, json.state = pending");
    expect(
      said.filter(choice => choice === "ci: json.state = pending"),
    ).toEqual([]);
  });

  it("can't end a wait by running out on a look its condition holds for", async () => {
    const graph = graphOf(
      [WATCHED, `after: ${CLAUDE}`],
      ["{ from: ci, to: after, when: \"!ok && json.state == 'done'\" }"],
    );
    expect(ran(await walkWorkflow(graph))("after")).toBe(false);
  });

  it("asks a loop edge into a router what the router reads", async () => {
    const graph = graphOf(
      [
        "a: { type: agent.worker, prompt: x, output: { schema: { status: [pass] } } }",
        `r: ${ROUTER}`,
        `b: ${CLAUDE}`,
        `out: ${CLAUDE}`,
      ],
      [
        "a -> r",
        "{ from: r, to: out, when: \"status == 'done'\" }",
        "{ from: r, to: b, when: \"status != 'done'\" }",
        "{ from: b, to: r, maxRounds: 2 }",
      ],
    );
    // Only `b` can say `done`, and only a loop edge carries it to the router.
    expect(ran(await walkWorkflow(graph))("out")).toBe(true);
  });

  it("makes no claim about a join a loop's next round can fill early", async () => {
    const graph = graphOf(
      [
        `a: ${SHELL}`,
        `b: ${CLAUDE}`,
        `c: ${CLAUDE}`,
        "j: { type: control.join, mode: n, n: 2 }",
      ],
      [
        '{ from: a, to: b, when: "exitCode == 0" }',
        "{ from: b, to: c, when: \"status == 'done'\" }",
        '{ from: a, to: j, when: "exitCode != 0" }',
        "{ from: c, to: j }",
        "{ from: b, to: a, maxRounds: 3, when: \"status == 'done'\" }",
      ],
    );
    const result = await walkWorkflow(graph);
    // In the order a walk tries, `c` finishes before `a` comes round again.
    expect(ran(result)("j")).toBe(false);
    expect(found(result)).toEqual([]);
    // If it finishes after, the join has both.
    const orders = await Promise.all(
      [0, 1, 2, 3].map(order => explore(graph, order, 1500)),
    );
    expect(orders.some(({ ran: seen }) => seen.has("j"))).toBe(true);
  });

  it("makes a condition go both ways from what it asks", async () => {
    const graph = graphOf(
      [
        "a: { type: tool.shell, command: 'true', allow: ['true'], output: { format: json } }",
        `big: ${CLAUDE}`,
        `small: ${CLAUDE}`,
        `said: ${CLAUDE}`,
        `other: ${CLAUDE}`,
        `flagged: ${CLAUDE}`,
      ],
      [
        '{ from: a, to: big, when: "json.count > 3" }',
        '{ from: a, to: small, when: "json.count <= 3" }',
        "{ from: a, to: said, when: \"contains(stdout, 'yes')\" }",
        "{ from: a, to: other, when: \"!contains(stdout, 'yes')\" }",
        '{ from: a, to: flagged, when: "json.flag" }',
      ],
    );
    const result = await walkWorkflow(graph);
    const reached = ran(result);
    expect(found(result)).toEqual([]);
    expect(
      ["big", "small", "said", "other", "flagged"].every(name => reached(name)),
    ).toBe(true);
  });

  it("reads through a router to the node before it", async () => {
    const graph = graphOf(
      [`a: ${CLAUDE}`, `r: ${ROUTER}`, `x: ${CLAUDE}`, `y: ${CLAUDE}`],
      [
        "a -> r",
        "{ from: r, to: x, when: \"status == 'pass'\" }",
        "{ from: r, to: y, when: \"status == 'changes_requested'\" }",
      ],
    );
    const result = await walkWorkflow(graph);
    const reached = ran(result);
    expect(found(result)).toEqual([]);
    expect([reached("x"), reached("y")]).toEqual([true, true]);
  });

  it("tries a value nothing reads only once", async () => {
    const graph = graphOf(
      [`a: ${CLAUDE}`, `b: ${CLAUDE}`, `c: ${CLAUDE}`],
      ["a -> b", "a -> c"],
    );
    // Each succeeds or fails: no condition asks which status.
    expect((await walkWorkflow(graph)).paths).toBe(5);
  });

  it("can't be made to write outside a node's output", async () => {
    const graph = graphOf(
      [
        "a: { type: tool.shell, command: 'true', allow: ['true'], output: { format: json } }",
        `b: ${CLAUDE}`,
      ],
      ["{ from: a, to: b, when: \"json.__proto__.polluted == 'yes'\" }"],
    );
    await walkWorkflow(graph);
    expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
  });

  it("counts each path once", async () => {
    const result = await walkWorkflow(graphOf([`a: ${CLAUDE}`], []));
    expect(result).toMatchObject({ paths: 2, succeeded: 1, failed: 1 });
  });
});

const summary = (parts: Partial<WalkResult>): string =>
  walkSummary({
    paths: 0,
    complete: true,
    succeeded: 0,
    failed: 0,
    endings: [],
    findings: [],
    ...parts,
  });

describe("what a walk comes to", () => {
  it("counts the ways through", () => {
    expect(summary({ paths: 73, succeeded: 5, failed: 68 })).toBe(
      "Walked 73 ways through: 5 succeed, 68 fail.",
    );
  });

  it("reads right for one", () => {
    expect(summary({ paths: 1, succeeded: 1, failed: 1 })).toBe(
      "Walked 1 way through: 1 succeeds, 1 fails.",
    );
  });

  it("says when it stopped", () => {
    expect(summary({ paths: 4096, complete: false })).toBe(
      "Walked 4,096 ways through and stopped; not every way was tried.",
    );
  });
});

describe("every example", () => {
  it.each(exampleFiles)("%s walks to the end, with no finding", async file => {
    const graph = compile(readFileSync(path.join(examples, file), "utf8"));
    const result = await walkWorkflow(graph);
    expect(result.complete).toBe(true);
    expect(found(result)).toEqual([]);
    expect(result.paths).toBe(result.succeeded + result.failed);
  });

  it("wait-for-ci only says `pending` by running out of time", async () => {
    const file = path.join(examples, "wait-for-ci.ork.yaml");
    const result = await walkWorkflow(compile(readFileSync(file, "utf8")));
    const said = result.endings.flatMap(({ choices }) => choices);
    expect(said.filter(choice => endedOnPending(choice))).toEqual([]);
  });
});
