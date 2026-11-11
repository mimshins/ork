/** @file Holding a node to what it declares of its output (RFC-010). */

import { type ClaudeNode, isClaudeNode, NodeSchema } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import { declaredProblem } from "../src/run/declared.ts";
import { reportSchemaFor } from "../src/runtime/report.ts";

const claudeNode = (schema: Record<string, unknown>): ClaudeNode => {
  const node = NodeSchema.parse({ type: "agent.worker", output: { schema } });
  if (!isClaudeNode(node)) throw new Error("not a Claude node");
  return node;
};

describe("declaredProblem", () => {
  it("has nothing to say with nothing declared", () => {
    expect(declaredProblem(undefined, "anything")).toBeNull();
    expect(declaredProblem({}, "anything")).toBeNull();
  });

  it("accepts what fits", () => {
    expect(
      declaredProblem(
        { state: ["OPEN", "CLOSED"], n: "integer", on: "boolean", s: "string" },
        { state: "OPEN", n: 2, on: false, s: "x", more: 1 },
      ),
    ).toBeNull();
  });

  it("names the field, the value and what was expected", () => {
    expect(
      declaredProblem(
        { state: ["OPEN", "CLOSED", "MERGED"] },
        { state: "DRAFT" },
      ),
    ).toBe("state is `DRAFT`, expected `OPEN`, `CLOSED` or `MERGED`");
    expect(declaredProblem({ n: "integer" }, { n: 1.5 })).toBe(
      "n is `1.5`, expected a whole number",
    );
    expect(declaredProblem({ n: "number" }, { n: "1" })).toBe(
      "n is `1`, expected a number",
    );
  });

  it("reports a missing field, and every problem", () => {
    expect(declaredProblem({ a: ["x"], b: "string" }, {})).toBe(
      "a is missing, expected `x`; b is missing, expected text",
    );
  });

  it("refuses a result that has no fields", () => {
    expect(declaredProblem({ a: "string" }, [1])).toBe(
      "the result isn't a JSON object",
    );
    expect(declaredProblem({ a: "string" }, null)).toBe(
      "the result isn't a JSON object",
    );
  });

  it("leaves a field written out as JSON Schema to the driver", () => {
    expect(declaredProblem({ a: { type: "string" } }, {})).toBeNull();
  });

  it("holds a declared list to being a list", () => {
    const rule = { tasks: { list: {} } };
    expect(declaredProblem(rule, { tasks: [] })).toBeNull();
    expect(declaredProblem(rule, { tasks: ["a", 1, null] })).toBeNull();
    expect(declaredProblem(rule, { tasks: "fix it" })).toBe(
      "tasks is `fix it`, expected a list",
    );
    expect(declaredProblem(rule, {})).toBe("tasks is missing, expected a list");
  });

  it("holds each item to the shape, naming its index", () => {
    const rule = { tasks: { list: { title: "string", n: "integer" } } };
    expect(
      declaredProblem(rule, { tasks: [{ title: "a", n: 1, more: true }] }),
    ).toBeNull();
    expect(
      declaredProblem(rule, { tasks: [{ title: "a", n: 1 }, { n: 1.5 }] }),
    ).toBe(
      "tasks[1].title is missing, expected text; tasks[1].n is `1.5`, expected a whole number",
    );
    expect(declaredProblem(rule, { tasks: [{ title: "a", n: 1 }, "b"] })).toBe(
      "tasks[1] is `b`, expected an object",
    );
  });

  it("names only the first bad item of a list", () => {
    expect(
      declaredProblem({ tasks: { list: { a: ["x"] } } }, { tasks: [{}, {}] }),
    ).toBe("tasks[0].a is missing, expected `x`");
  });

  it("reads a field that isn't quite a list rule as JSON Schema", () => {
    expect(
      declaredProblem({ a: { list: {}, type: "string" } }, { a: 1 }),
    ).toBeNull();
  });

  it("clips a long value", () => {
    expect(declaredProblem({ a: ["x"] }, { a: "y".repeat(200) })).toContain(
      "…",
    );
  });
});

describe("reportSchemaFor a declared list", () => {
  it("is an array of closed items with a shape", () => {
    expect(
      reportSchemaFor(
        claudeNode({ tasks: { list: { title: "string", kind: ["a", "b"] } } }),
      )["properties"],
    ).toMatchObject({
      tasks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            kind: { enum: ["a", "b"] },
          },
          required: ["title", "kind"],
          additionalProperties: false,
        },
      },
    });
  });

  it("is an array of anything without one, and required", () => {
    const schema = reportSchemaFor(claudeNode({ tasks: { list: {} } }));
    expect(schema["properties"]).toMatchObject({
      tasks: { type: "array", items: {} },
    });
    expect(schema["required"]).toContain("tasks");
  });
});
