/**
 * @file Tests for the workflow format: parsing, diagnostics with positions, the
 *   canonical round trip, and the committed JSON Schema.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  expandEdge,
  parseLayout,
  parseWorkflow,
  renderJsonSchema,
  serializeLayout,
  serializeWorkflow,
} from "../src/index.ts";

const example = readFileSync(
  new URL("../../../examples/software-factory.ork.yaml", import.meta.url),
  "utf8",
);

const parseOk = (text: string) => {
  const result = parseWorkflow(text);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.workflow;
};

const parseErrors = (text: string) => {
  const result = parseWorkflow(text);
  if (result.ok) throw new Error("expected diagnostics");
  return result.diagnostics;
};

const expandOk = (input: string) => {
  const result = expandEdge(input, 0);
  if (!result.ok) throw new Error(result.message);
  return result.edges;
};

describe("parseWorkflow", () => {
  it("accepts the software-factory example", () => {
    const workflow = parseOk(example);
    expect(Object.keys(workflow.nodes)).toHaveLength(11);
  });

  it("reports YAML syntax errors with a line number", () => {
    const [diagnostic] = parseErrors("schemaVersion: 1\nnodes: [\n");
    expect(diagnostic?.code).toBe("yaml.syntax");
    expect(diagnostic?.line).toBeGreaterThanOrEqual(2);
  });

  it("names the unknown node type and points at its line", () => {
    const [diagnostic] = parseErrors(
      "schemaVersion: 1\nname: x\nnodes:\n  a:\n    type: claude.boss\n",
    );
    expect(diagnostic?.message).toContain('unknown node type "claude.boss"');
    expect(diagnostic?.path).toEqual(["nodes", "a", "type"]);
    expect(diagnostic?.line).toBe(5);
  });

  it("points at an unknown key", () => {
    const [diagnostic] = parseErrors(
      "schemaVersion: 1\nname: x\nnodes:\n  a:\n    type: control.split\n    colour: red\n",
    );
    expect(diagnostic?.message).toBe("unknown key: colour");
    expect(diagnostic?.line).toBe(6);
  });
});

describe("serializeWorkflow", () => {
  it("is byte-stable on the example", () => {
    const once = serializeWorkflow(parseOk(example));
    expect(once).toBe(example);
    expect(serializeWorkflow(parseOk(once))).toBe(once);
  });

  it("orders keys canonically and normalizes edge shorthand", () => {
    const text = serializeWorkflow(
      parseOk(
        [
          "nodes:",
          "  b: { prompt: hi, type: claude.worker }",
          "  a: { type: control.split }",
          "edges: ['a->b', { from: a, to: [b] }]",
          "name: x",
          "schemaVersion: 1",
        ].join("\n"),
      ),
    );
    expect(text).toContain(
      "schemaVersion: 1\nname: x\nnodes:\n  b:\n    type: claude.worker\n    prompt: hi\n",
    );
    expect(text).toContain("edges:\n  - a -> b\n  - a -> b\n");
  });
});

describe("expandEdge", () => {
  it("expands lists on both sides", () => {
    expect(expandOk("a, b -> c, d").map(e => `${e.from}${e.to}`)).toEqual([
      "ac",
      "ad",
      "bc",
      "bd",
    ]);
  });

  it("rejects a chain", () => {
    expect(expandEdge("a -> b -> c", 0).ok).toBe(false);
  });
});

const parseLayoutOk = (text: string) => {
  const result = parseLayout(text);
  if (!result.ok) throw new Error(result.message);
  return result.layout;
};

describe("layout", () => {
  it("sorts node ids and round-trips", () => {
    const text = serializeLayout({
      schemaVersion: 1,
      nodes: { b: { x: 1, y: 2 }, a: { x: 3, y: 4 } },
    });
    expect(text.indexOf('"a"')).toBeLessThan(text.indexOf('"b"'));
    expect(parseLayout(text)).toMatchObject({ ok: true });
    expect(serializeLayout(parseLayoutOk(text))).toBe(text);
  });
});

describe("workflow.schema.json", () => {
  it("is up to date (run `pnpm --dir packages/schema gen:json-schema`)", () => {
    const committed = readFileSync(
      new URL("../workflow.schema.json", import.meta.url),
      "utf8",
    );
    expect(committed).toBe(renderJsonSchema());
  });
});
