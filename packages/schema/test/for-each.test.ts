/**
 * @file Tests for `forEach` and the `list` output shape (RFC-013): which nodes
 *   take it, the two ways to give a list, and the canonical round trip.
 */

import { describe, expect, it } from "vitest";

import { parseWorkflow, serializeWorkflow } from "../src/index.ts";

const parses = (node: string): boolean =>
  parseWorkflow(
    ["schemaVersion: 1", "name: t", "nodes:", `  n: ${node}`].join("\n"),
  ).ok;

/** The text a workflow serializes to, and the text of that parsed again. */
const roundTrip = (text: string): [string, string] => {
  const first = parseWorkflow(text);
  if (!first.ok) throw new Error("did not parse");
  const once = serializeWorkflow(first.workflow);
  const second = parseWorkflow(once);
  if (!second.ok) throw new Error("did not parse again");
  return [once, serializeWorkflow(second.workflow)];
};

/** The workflow's text with one tool node declaring this output rule. */
const declares = (rule: string): boolean =>
  parses(
    `{ type: tool.shell, command: ls, output: { format: json, schema: { tasks: ${rule} } } }`,
  );

const FROM = '{ from: "{{nodes.plan.output.tasks}}", maxItems: 8 }';

describe("forEach", () => {
  it.each([
    "{ type: agent.worker, prompt: Go, forEach: ITEMS }",
    "{ type: tool.shell, command: ls, forEach: ITEMS }",
    "{ type: tool.gh, command: pr list, forEach: ITEMS }",
    "{ type: mcp.call, server: s, tool: t, forEach: ITEMS }",
    "{ type: workflow.call, workflow: w, forEach: ITEMS }",
  ])("parses on %s with a static list or a source", node => {
    expect(parses(node.replace("ITEMS", "{ items: [a, b] }"))).toBe(true);
    expect(parses(node.replace("ITEMS", FROM))).toBe(true);
  });

  it("takes maxParallel and onFailure in both shapes", () => {
    const extra = "maxParallel: 2, onFailure: stop";
    expect(
      parses(
        `{ type: agent.worker, prompt: Go, forEach: { items: [a], ${extra} } }`,
      ),
    ).toBe(true);
    expect(
      parses(
        `{ type: agent.worker, prompt: Go, forEach: { from: x, maxItems: 3, ${extra} } }`,
      ),
    ).toBe(true);
  });

  it.each([
    ["from without maxItems", "{ from: x }"],
    ["an empty list", "{ items: [] }"],
    ["neither items nor from", "{ maxParallel: 2 }"],
    ["items and from together", "{ items: [a], from: x, maxItems: 2 }"],
    ["maxItems of zero", "{ from: x, maxItems: 0 }"],
    ["maxParallel of zero", "{ items: [a], maxParallel: 0 }"],
    ["an unknown onFailure", "{ items: [a], onFailure: retry }"],
  ])("is refused with %s", (_name, value) => {
    expect(
      parses(`{ type: agent.worker, prompt: Go, forEach: ${value} }`),
    ).toBe(false);
  });

  it.each([
    "{ type: agent.leader, prompt: Go, forEach: { items: [a] } }",
    "{ type: human.gate, question: q, options: [a, b], forEach: { items: [a] } }",
    "{ type: agent.subagent, parent: p, description: d, forEach: { items: [a] } }",
    "{ type: control.split, forEach: { items: [a] } }",
    "{ type: control.join, forEach: { items: [a] } }",
    "{ type: control.router, forEach: { items: [a] } }",
  ])("is refused on %s", node => {
    expect(parses(node)).toBe(false);
  });
});

describe("a declared list", () => {
  it.each(["{ list: {} }", "{ list: { title: string } }"])(
    "parses as %s",
    rule => {
      expect(declares(rule)).toBe(true);
    },
  );

  it("takes the rules a top-level field takes for its fields", () => {
    expect(declares("{ list: { state: [open, closed], n: integer } }")).toBe(
      true,
    );
  });

  it.each(["{ list: { title: text } }", "{ list: string }", "{ lst: {} }"])(
    "is refused as %s",
    rule => {
      expect(declares(rule)).toBe(false);
    },
  );
});

describe("the canonical form", () => {
  it("round-trips forEach and places it after notify, before the step fields", () => {
    const [text, again] = roundTrip(
      [
        "schemaVersion: 1",
        "name: t",
        "nodes:",
        "  build:",
        "    prompt: Do {{item.title}}",
        "    forEach: { from: x, maxItems: 4, maxParallel: 2 }",
        "    type: agent.worker",
      ].join("\n"),
    );
    expect(text).toContain(
      [
        "    type: agent.worker",
        "    prompt: Do {{item.title}}",
        "    forEach:",
        "      from: x",
        "      maxItems: 4",
        "      maxParallel: 2",
      ].join("\n"),
    );
    expect(again).toBe(text);
  });
});

/** The messages a node line makes the parser give, in order. */
const messages = (node: string): string[] => {
  const parsed = parseWorkflow(
    ["schemaVersion: 1", "name: t", "nodes:", `  n: ${node}`].join("\n"),
  );
  return parsed.ok ? [] : parsed.diagnostics.map(d => d.message);
};

const worker = (forEach: string) =>
  messages(`{ type: agent.worker, prompt: Go, forEach: ${forEach} }`);

describe("the messages for a forEach that is wrong", () => {
  it.each([
    ["from without maxItems", "{ from: x }", "needs `maxItems`"],
    ["an empty list", "{ items: [] }", "at least one item"],
    ["maxItems of zero", "{ from: x, maxItems: 0 }", "must be at least 1"],
    ["neither items nor from", "{ maxParallel: 2 }", "needs `items` or `from`"],
    ["items and from", "{ items: [a], from: x, maxItems: 2 }", "not both"],
    ["a string", "x", "takes a map"],
  ])("says what to do for %s", (_name, value, text) => {
    expect(worker(value)).toEqual([expect.stringContaining(text)]);
  });

  it("says a list rule takes a map of its fields", () => {
    expect(
      messages(
        "{ type: tool.shell, command: ls, output: { format: json, schema: { tasks: { list: string } } } }",
      ),
    ).toEqual([expect.stringContaining("`list` takes a map")]);
  });

  it.each(["{ list: string }", "{ list: { title: text } }"])(
    "says the same for a Claude node's %s",
    rule => {
      expect(
        messages(
          `{ type: agent.worker, prompt: Go, output: { schema: { tasks: ${rule} } } }`,
        ),
      ).toEqual([expect.stringContaining("`list` takes a map")]);
    },
  );

  it("still takes JSON Schema and value rules in a Claude node's output", () => {
    expect(
      messages(
        "{ type: agent.worker, prompt: Go, output: { schema: { a: { type: array }, b: [x, y], c: { list: {} } } } }",
      ),
    ).toEqual([]);
  });
});

describe("a Claude node's effort", () => {
  it.each(['"high"', '"{{item.effort}}"'])("takes %s", effort => {
    expect(
      parses(`{ type: agent.worker, prompt: Go, effort: ${effort} }`),
    ).toBe(true);
  });

  it("refuses a value that is neither a level nor a template", () => {
    expect(
      messages("{ type: agent.worker, prompt: Go, effort: hard }"),
    ).toEqual([expect.stringContaining("low, medium, high, xhigh or max")]);
  });

  it("takes only a level in defaults", () => {
    expect(
      parseWorkflow(
        [
          "schemaVersion: 1",
          "name: t",
          'defaults: { effort: "{{item.effort}}" }',
          "nodes:",
          "  n: { type: agent.worker, prompt: Go }",
        ].join("\n"),
      ).ok,
    ).toBe(false);
  });
});
