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
  walkChecks,
  walkSummary,
  walkWorkflow,
  type WalkResult,
} from "../src/index.ts";

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

const CLAUDE = "{ type: claude.worker, prompt: x }";
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
        "a: { type: claude.worker, prompt: x, output: { schema: { kind: [one, two] } } }",
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
        "lead: { type: claude.leader, prompt: x }",
        "kid: { type: claude.worker, prompt: x, parent: lead }",
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
        "lead: { type: claude.leader, prompt: x }",
        "child: { type: claude.worker, prompt: x, parent: lead }",
        `t: ${CLAUDE}`,
      ],
      ["{ from: lead, to: t, when: \"nodes.child.output.status == 'pass'\" }"],
    ],
    [
      "a loop that a child's report would end",
      [
        "lead: { type: claude.leader, prompt: x }",
        "child: { type: claude.worker, prompt: x, parent: lead }",
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
  ])("makes no claim about %s", async (_, nodes, edges) => {
    const graph = graphOf(nodes, edges, [
      "inputs:",
      "  env: { type: string, default: dev }",
    ]);
    expect(found(await walkWorkflow(graph))).toEqual([]);
  });

  it("stays within its time even inside one path", async () => {
    const result = await walkWorkflow(diamonds(30), { maxMs: 50 });
    expect(result.complete).toBe(false);
    expect(found(result)).toEqual([]);
  }, 5000);

  it("ends what a live owner would answer, with no owner live", async () => {
    const graph = graphOf(
      [
        "lead: { type: claude.leader, prompt: x }",
        "kid: { type: claude.worker, prompt: x, parent: lead }",
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
    // It only says `pending` by running out of time, and that's a failure.
    expect(said).toContain("ci: timed out, json.state = pending");
    expect(
      said.filter(choice => choice === "ci: json.state = pending"),
    ).toEqual([]);
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
