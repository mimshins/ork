/**
 * @file Tests for the workflow format: parsing, diagnostics with positions, a
 *   file from a newer Ork, the canonical round trip, and the committed JSON
 *   Schemas.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  diagnosticText,
  expandEdge,
  parseTriggers,
  parseWorkflow,
  renderJsonSchema,
  renderProjectJsonSchema,
  renderSettingsJsonSchema,
  renderTriggersJsonSchema,
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

const messagesOf = (text: string): string => {
  const parsed = parseWorkflow(text);
  return parsed.ok
    ? ""
    : parsed.diagnostics.map(({ message }) => message).join();
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

  it("marks the values Zod quotes", () => {
    const said = messagesOf(
      "schemaVersion: 1\nname: t\ninputs:\n  x: { type: nope }\nnodes: {}\n",
    );
    expect(said).toContain("`string`");
    expect(said).not.toContain('"');
  });

  it("refuses a renamed node type, naming the new one and `ork migrate`", () => {
    const [diagnostic] = parseErrors(
      "schemaVersion: 1\nname: x\nnodes:\n  a:\n    type: claude.worker\n    prompt: hi\n",
    );
    expect(diagnostic?.message).toBe(
      "`claude.worker` was renamed to `agent.worker`; run `ork migrate`",
    );
    expect(diagnostic?.line).toBe(5);
  });

  it("names the unknown node type and points at its line", () => {
    const [diagnostic] = parseErrors(
      "schemaVersion: 1\nname: x\nnodes:\n  a:\n    type: claude.boss\n",
    );
    expect(diagnostic?.message).toContain("unknown node type `claude.boss`");
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

  it("says a file with a higher schemaVersion was made by a newer Ork, and only that", () => {
    expect(
      parseErrors("schemaVersion: 2\nname: x\nnodes:\n  a: { future: 1 }\n"),
    ).toEqual([
      {
        severity: "error",
        code: "schema.newer_version",
        message:
          "this file was made by a newer Ork (`schemaVersion: 2`; this one reads 1). Upgrade with `ork upgrade`.",
        path: ["schemaVersion"],
        line: 1,
        column: 16,
      },
    ]);
    expect(parseTriggers("schemaVersion: 3\ntriggers: {}\n")).toMatchObject({
      ok: false,
      diagnostics: [{ code: "schema.newer_version" }],
    });
    // An older or made-up one is only wrong.
    expect(messagesOf("schemaVersion: 0\nname: x\nnodes: {}\n")).toContain(
      "expected 1",
    );
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
          "  b: { prompt: hi, type: agent.worker }",
          "  a: { type: control.split }",
          "edges: ['a->b', { from: a, to: [b] }]",
          "name: x",
          "schemaVersion: 1",
        ].join("\n"),
      ),
    );
    expect(text).toContain(
      "schemaVersion: 1\nname: x\nnodes:\n  b:\n    type: agent.worker\n    prompt: hi\n",
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

describe("workflow.schema.json", () => {
  it("is up to date (run `pnpm --dir packages/schema gen:json-schema`)", () => {
    const committed = readFileSync(
      new URL("../workflow.schema.json", import.meta.url),
      "utf8",
    );
    expect(committed).toBe(renderJsonSchema());
  });
});

describe("the other committed JSON Schemas", () => {
  it.each([
    ["project.schema.json", renderProjectJsonSchema],
    ["settings.schema.json", renderSettingsJsonSchema],
    ["triggers.schema.json", renderTriggersJsonSchema],
  ])(
    "%s is up to date (run `pnpm --dir packages/schema gen:json-schema`)",
    (file, render) => {
      const committed = readFileSync(
        new URL(`../${file}`, import.meta.url),
        "utf8",
      );
      expect(committed).toBe(render());
    },
  );
});

describe("diagnosticText", () => {
  const base = { severity: "error", code: "project.rules", path: [] } as const;

  it("is the message alone for the file being checked", () => {
    expect(diagnosticText({ ...base, message: "Invalid input", line: 3 })).toBe(
      "Invalid input",
    );
  });

  it("leads with the place when the problem is in another file", () => {
    expect(
      diagnosticText({
        ...base,
        message: "Invalid input",
        file: ".ork/project.yaml",
        line: 3,
        column: 14,
      }),
    ).toBe(".ork/project.yaml:3:14: Invalid input");
  });
});
