/**
 * @file What a new edge starts with (RFC-010), so it's never left in a state
 *   the checks would refuse, and what can be shown as choices.
 */

import { draftGraph } from "@krapht/ork-server";
import { describe, expect, it } from "vitest";

import {
  connectEdit,
  saysOf,
  shownCondition,
  unhandledAnswers,
} from "../../src/builder/condition-model.ts";

const TOOL = "{ type: tool.shell, command: x }";

const graphOf = (edges: string) =>
  draftGraph(`schemaVersion: 1
name: t
nodes:
  a: { type: agent.worker }
  b: { type: agent.worker }
  c: ${TOOL}
  g: { type: human.gate, question: q, options: [ship, keep] }
  r: { type: control.router }
edges:
${edges}
`).graph;

const edgeOf = (edges: string, from: string, to: string) => {
  const graph = graphOf(edges);
  const edge = graph.edges.find(e => e.from === from && e.to === to);
  if (edge === undefined) throw new Error("no such edge");
  return { edge, says: saysOf(graph, from) };
};

describe("connectEdit", () => {
  it("leaves an ordinary edge plain", () => {
    expect(connectEdit(graphOf("  - a -> b"), "b", "c")).toEqual({
      op: "connect",
      from: "b",
      to: "c",
    });
  });

  it("gives a closed loop its condition and rounds", () => {
    expect(connectEdit(graphOf("  - a -> b"), "b", "a")).toEqual({
      op: "connect",
      from: "b",
      to: "a",
      when: "status == 'changes_requested'",
      maxRounds: 3,
    });
  });

  it("gives a loop back to the node itself the same", () => {
    expect(connectEdit(graphOf("  - a -> b"), "a", "a")).toMatchObject({
      maxRounds: 3,
    });
  });

  it("starts a way out of a loop as what the loop isn't", () => {
    const graph = graphOf(
      "  - a -> b\n  - { from: b, to: a, when: \"status == 'fail'\", maxRounds: 2 }",
    );
    expect(connectEdit(graph, "b", "c")).toMatchObject({
      when: "status != 'fail'",
    });
  });

  it("gives a gate's edges its answers in turn, then none", () => {
    expect(connectEdit(graphOf("  - a -> b"), "g", "c")).toMatchObject({
      when: "choice == 'ship'",
    });
    const one = graphOf("  - { from: g, to: c, when: \"choice == 'ship'\" }");
    expect(connectEdit(one, "g", "a")).toMatchObject({
      when: "choice == 'keep'",
    });
    const both = graphOf(
      "  - { from: g, to: c, when: \"choice == 'ship'\" }\n  - { from: g, to: a, when: \"choice == 'keep'\" }",
    );
    expect(connectEdit(both, "g", "b")).toEqual({
      op: "connect",
      from: "g",
      to: "b",
    });
  });

  it("gives a router a test, or a fallback with nothing to test", () => {
    expect(connectEdit(graphOf("  - a -> r"), "r", "c")).toMatchObject({
      when: "status == 'pass'",
    });
    expect(connectEdit(graphOf("  - a -> b"), "r", "c")).toMatchObject({
      when: "true",
    });
  });
});

describe("unhandledAnswers", () => {
  it("names the answers no edge follows", () => {
    expect(
      unhandledAnswers(
        graphOf("  - { from: g, to: c, when: \"choice == 'ship'\" }"),
        "g",
      ),
    ).toEqual(["keep"]);
  });

  it("has none with no edges yet, or an edge for every answer", () => {
    expect(unhandledAnswers(graphOf("  - a -> b"), "g")).toEqual([]);
    expect(unhandledAnswers(graphOf("  - g -> c"), "g")).toEqual([]);
  });
});

describe("shownCondition", () => {
  it("shows what the choices can say as choices", () => {
    const { edge, says } = edgeOf(
      "  - { from: a, to: b, when: \"status == 'pass'\" }",
      "a",
      "b",
    );
    expect(shownCondition(edge, says).mode).toBe("test");
  });

  it("keeps a value off the list as written, to be seen", () => {
    const when = "status == 'failed'";
    const { edge, says } = edgeOf(
      `  - { from: a, to: b, when: "${when}" }`,
      "a",
      "b",
    );
    expect(shownCondition(edge, says)).toEqual({ mode: "hand", text: when });
  });

  it("keeps a field nothing declares as written", () => {
    const when = "json.state == 'OPEN'";
    const { edge, says } = edgeOf(
      `  - { from: c, to: b, when: "${when}" }`,
      "c",
      "b",
    );
    expect(shownCondition(edge, says)).toEqual({ mode: "hand", text: when });
  });
});
