import { readFileSync } from "node:fs";

import { parseWorkflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import { compileWorkflow } from "../src/index.ts";

const load = (text: string) => {
  const result = parseWorkflow(text);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.workflow;
};

const compile = (text: string) => compileWorkflow(load(text));

const codes = (text: string) =>
  compile(text).diagnostics.map(d => `${d.severity}:${d.code}`);

const workflow = (body: string) =>
  `schemaVersion: 1\nname: t\ninputs:\n  feature:\n    type: string\n${body}`;

describe("compileWorkflow", () => {
  it("compiles the software-factory example with no diagnostics", () => {
    const example = readFileSync(
      new URL("../../../examples/software-factory.ork.yaml", import.meta.url),
      "utf8",
    );
    const result = compile(example);
    expect(result.diagnostics).toEqual([]);
    expect(result.graph?.entries).toEqual(["spec"]);
    expect(result.graph?.nodes.get("builder")?.children).toEqual([
      "security",
      "ux",
      "code",
    ]);
    expect(result.graph?.edges).toHaveLength(11);
  });

  it("rejects a cycle with no maxRounds", () => {
    const result = compile(
      workflow(`nodes:
  a: { type: control.split }
  b: { type: control.split }
  c: { type: control.split }
edges:
  - a -> b
  - b -> c
  - c -> b
`),
    );
    expect(result.graph).toBeNull();
    expect(result.diagnostics[0]).toMatchObject({
      code: "graph.unbounded-cycle",
      path: ["edges", 1],
    });
  });

  it("accepts the same cycle when one edge is bounded", () => {
    expect(
      codes(
        workflow(`nodes:
  a: { type: control.split }
  b: { type: control.split }
  c: { type: control.split }
edges:
  - a -> b
  - b -> c
  - { from: c, to: b, maxRounds: 3 }
`),
      ),
    ).toEqual([]);
  });

  it("checks the ownership tree", () => {
    expect(
      codes(
        workflow(`nodes:
  lead: { type: claude.leader }
  w: { type: claude.worker, parent: lead }
  s: { type: claude.subagent, parent: w, description: helper }
  bad: { type: tool.shell, command: ls, parent: w }
  lost: { type: claude.worker, parent: ghost }
  x: { type: claude.leader, parent: y }
  y: { type: claude.leader, parent: x }
`),
      ),
    ).toEqual([
      "error:tree.owner-kind",
      "error:tree.unknown-parent",
      "error:tree.cycle",
      "warning:graph.unreachable",
      "warning:graph.unreachable",
      "warning:graph.unreachable",
    ]);
  });

  it("checks edges", () => {
    expect(
      codes(
        workflow(`nodes:
  lead: { type: claude.leader }
  sub: { type: claude.subagent, parent: lead, description: helper }
  end: { type: control.split }
edges:
  - lead -> nowhere
  - lead -> sub
  - lead -> end -> lead
  - { from: lead, to: end, when: "status ==" }
  - { from: lead, to: end, maxRounds: 2 }
`),
      ),
    ).toEqual([
      "error:edge.unknown-node",
      "error:edge.subagent",
      "error:edge.syntax",
      "error:edge.when-syntax",
      "warning:edge.max-rounds-unused",
    ]);
  });

  it("checks references in templates and conditions", () => {
    const diagnostics = compile(
      workflow(`nodes:
  a:
    type: claude.worker
    prompt: "{{inputs.feature}} {{inputs.missing}} {{nodes.b.output.summary}}"
  b:
    type: claude.worker
    prompt: "{{nodes.a.output.summary}} {{nodes.a.output.nope}} {{nodes.ghost.output.x}} {{nodes.a.summary}} {{verdict}}"
    output: { schema: { verdict: [yes, no] } }
  c: { type: control.split }
edges:
  - a -> b
  - { from: b, to: c, when: "verdict == 'yes' && colour == 'red'" }
`),
    ).diagnostics;
    expect(diagnostics.map(d => `${d.code} ${d.path.join(".")}`)).toEqual([
      "ref.input nodes.a.prompt",
      "ref.node nodes.b.prompt",
      "ref.node nodes.b.prompt",
      "template.scope nodes.b.prompt",
      "template.not-upstream nodes.a.prompt",
      "ref.field nodes.b.prompt",
      "ref.field edges.1.when",
    ]);
  });

  it("checks joins, gates and channels", () => {
    expect(
      codes(
        workflow(`nodes:
  a: { type: claude.leader }
  b: { type: claude.worker, parent: a }
  t: { type: tool.gh, command: pr list }
  j: { type: control.join, mode: n, n: 3 }
  g:
    type: human.gate
    question: ok?
    options: [yes, no]
    recommended: maybe
    timeout: 5m
edges:
  - a -> j
  - j -> g
messages:
  - between: [a, b]
  - between: [a, t]
`),
      ),
    ).toEqual([
      "error:join.n",
      "error:gate.option",
      "error:gate.timeout",
      "error:message.endpoint",
      "warning:join.inputs",
      "warning:message.implicit",
    ]);
  });

  it("requires an entry node", () => {
    expect(
      codes(
        workflow(`nodes:
  a: { type: control.split }
  b: { type: control.split }
edges:
  - { from: a, to: b, maxRounds: 1 }
  - { from: b, to: a, maxRounds: 1 }
`),
      ),
    ).toContain("error:graph.no-entry");
  });
});
