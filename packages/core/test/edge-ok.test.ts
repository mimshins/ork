/**
 * @file An edge can read how its source ended (RFC-010): the only way to catch
 *   a failure that leaves no field, such as a value outside what a node
 *   declared, or a failed MCP call.
 */

import { parseWorkflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import { compileWorkflow } from "../src/graph/compile.ts";
import type { CompiledGraph } from "../src/graph/types.ts";
import { decideEdges } from "../src/run/routing.ts";

const compiled = (when: string) => {
  const parsed = parseWorkflow(`schemaVersion: 1
name: t
nodes:
  a: { type: tool.shell, command: x }
  b: { type: tool.shell, command: y }
edges:
  - { from: a, to: b, when: "${when}" }
`);
  if (!parsed.ok) throw new Error("the workflow doesn't parse");
  return compileWorkflow(parsed.workflow);
};

const graphOf = (when: string): CompiledGraph => {
  const { graph } = compiled(when);
  if (graph === null) throw new Error("the workflow doesn't compile");
  return graph;
};

const taken = (when: string, ok: boolean, output = {}): boolean[] =>
  decideEdges(
    graphOf(when),
    "a",
    { ok, output },
    { inputs: {}, nodes: {} },
  ).map(edge => edge.taken);

describe("ok on an edge", () => {
  it("is how the node ended", () => {
    expect(taken("!ok", false)).toEqual([true]);
    expect(taken("!ok", true)).toEqual([false]);
    expect(taken("ok", true)).toEqual([true]);
  });

  it("gives way to a field the node reports", () => {
    expect(taken("!ok", true, { ok: false })).toEqual([true]);
  });

  it("is known to the compiler", () => {
    expect(compiled("!ok").diagnostics).toEqual([]);
  });
});
