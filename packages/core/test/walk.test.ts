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
      [
        [
          "ci: { type: tool.shell, command: 'true', allow: ['true'],",
          "output: { format: json, schema: { state: [pending, done] } },",
          "watch: { every: 30s, until: \"json.state != 'pending'\", timeout: 1h } }",
        ].join(" "),
        `waiting: ${CLAUDE}`,
        `finished: ${CLAUDE}`,
      ],
      [
        "{ from: ci, to: waiting, when: \"json.state == 'pending'\" }",
        "{ from: ci, to: finished, when: \"json.state == 'done'\" }",
      ],
    );
    const result = await walkWorkflow(graph);
    expect(found(result)).toEqual(["walk.never-runs nodes.waiting"]);
    expect(ran(result)("finished")).toBe(true);
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

describe("every example", () => {
  it.each(exampleFiles)("%s walks to the end, with no finding", async file => {
    const graph = compile(readFileSync(path.join(examples, file), "utf8"));
    const result = await walkWorkflow(graph);
    expect(result.complete).toBe(true);
    expect(found(result)).toEqual([]);
    expect(result.paths).toBe(result.succeeded + result.failed);
  });

  it("wait-for-ci never ends its wait on `pending`", async () => {
    const file = path.join(examples, "wait-for-ci.ork.yaml");
    const result = await walkWorkflow(compile(readFileSync(file, "utf8")));
    const said = result.endings.flatMap(({ choices }) => choices);
    expect(said.some(choice => choice.includes("pending"))).toBe(false);
  });
});
