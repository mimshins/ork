/**
 * @file Tests for reading the workflow's JSON Schema into form fields: every
 *   field of the format gets a real control, and the only values typed as free
 *   text are the ones the format itself leaves free (RFC-008).
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  actingOutside,
  factsOf,
  newNodeId,
  problemsAt,
  problemWords,
} from "../../src/builder/builder-model.ts";
import {
  emptyFor,
  isMultiline,
  type JsonSchema,
  kindOf,
  labelOf,
  nodeSchemaOf,
  nodeTypesOf,
  readFree,
  showFree,
  variantFor,
} from "../../src/builder/schema-model.ts";

const ROOT: JsonSchema = z
  .record(z.string(), z.unknown())
  .parse(
    JSON.parse(
      readFileSync(
        path.resolve(
          import.meta.dirname,
          "../../../schema/workflow.schema.json",
        ),
        "utf8",
      ),
    ),
  );

/** Every path in a schema that no control can describe. */
const freePaths = (schema: JsonSchema, at: string): string[] => {
  const kind = kindOf(schema);
  if (kind.kind === "free") return [at];
  if (kind.kind === "object") {
    return kind.fields.flatMap(({ key, schema: field }) =>
      freePaths(field, `${at}.${key}`),
    );
  }
  if (kind.kind === "list") return freePaths(kind.item, `${at}[]`);
  if (kind.kind === "record") return freePaths(kind.value, `${at}.*`);
  return kind.kind === "variants"
    ? kind.variants.flatMap(variant => freePaths(variant, at))
    : [];
};

/** The same, for the settings of the workflow itself. */
const freeTopLevel = (): string[] => {
  const kind = kindOf(ROOT);
  return kind.kind === "object"
    ? kind.fields
        .filter(({ key }) => key !== "nodes")
        .flatMap(({ key, schema }) => freePaths(schema, `workflow.${key}`))
    : [];
};

const nodeFree = (type: string): string[] => {
  const schema = nodeSchemaOf(ROOT, type);
  return schema === undefined ? [] : freePaths(schema, type);
};

describe("the whole format", () => {
  it("lists every node type", () => {
    expect(nodeTypesOf(ROOT)).toEqual([
      "claude.leader",
      "claude.worker",
      "claude.subagent",
      "tool.gh",
      "tool.aws",
      "tool.git",
      "tool.shell",
      "control.split",
      "control.join",
      "control.router",
      "human.gate",
      "workflow.call",
      "mcp.call",
    ]);
  });

  it("types only the values the format leaves free", () => {
    const paths = new Set(nodeTypesOf(ROOT).flatMap(type => nodeFree(type)));
    expect([...paths].toSorted()).toEqual([
      "claude.leader.output.schema.*",
      "claude.subagent.output.schema.*",
      "claude.worker.output.schema.*",
      "mcp.call.arguments.*",
    ]);
  });

  it("has a control for every top-level setting, agents included", () => {
    expect(freeTopLevel().toSorted()).toEqual([
      "workflow.agents.*.output.schema.*",
      "workflow.inputs.*.default",
    ]);
  });
});

describe("a field", () => {
  it("offers on, off and each level for a mixed choice", () => {
    expect(
      kindOf({
        anyOf: [{ type: "boolean" }, { enum: ["lite", "full"] }],
      }),
    ).toEqual({
      kind: "choice",
      options: [
        { value: true, label: "On" },
        { value: false, label: "Off" },
        { value: "lite", label: "lite" },
        { value: "full", label: "full" },
      ],
    });
  });

  it("chooses the variant its value is", () => {
    const variants: JsonSchema[] = [{ type: "string" }, { type: "array" }];
    expect(variantFor(variants, "a")).toBe(0);
    expect(variantFor(variants, ["a"])).toBe(1);
    expect(emptyFor({ type: "array" })).toEqual([]);
  });

  it("reads a free value as JSON if it can, else as text", () => {
    expect(readFree("42")).toBe(42);
    expect(readFree('["a", "b"]')).toEqual(["a", "b"]);
    expect(readFree("{{inputs.issue}}")).toBe("{{inputs.issue}}");
    expect(readFree("  ")).toBeUndefined();
    expect(showFree(["a"])).toBe('["a"]');
    expect(showFree("plain")).toBe("plain");
  });

  it.each([
    ["1.10", "1.10"],
    ["1.0", "1.0"],
    ["12345678901234567890", "12345678901234567890"],
    ["1.1", 1.1],
    ["true", true],
    ["null", null],
    ['"5"', "5"],
    ['""', ""],
    ['{"a": 1}', { a: 1 }],
    ["[broken", "[broken"],
  ])("reads %s as typed", (typed, value) => {
    expect(readFree(typed)).toEqual(value);
  });

  it.each([
    "5",
    "true",
    "null",
    "[a]",
    "plain",
    "1.10",
    'say "hi"',
    7,
    false,
    null,
  ])("shows %s so that reading it gives it back", value => {
    expect(readFree(showFree(value))).toEqual(value);
  });

  it("keeps a free value's spacing when it's text", () => {
    expect(readFree("  a b ")).toBe("  a b ");
  });

  it("has words a person would use", () => {
    expect(labelOf("maxTurns")).toBe("Max turns");
    expect(labelOf("budgetUsd")).toBe("Budget (USD)");
    expect(isMultiline("prompt", "")).toBe(true);
    expect(isMultiline("label", "one\ntwo")).toBe(true);
    expect(isMultiline("label", "one")).toBe(false);
  });
});

const error = (at: (string | number)[]) => ({
  severity: "error" as const,
  code: "x",
  message: `bad ${at.join(".")}`,
  path: at,
});

describe("what the builder means", () => {
  const graph = {
    nodes: [
      { id: "a", type: "tool.gh" },
      { id: "b", type: "claude.worker" },
      { id: "c", type: "mcp.call" },
    ],
    edges: [],
    channels: [],
  };

  it("names a new node after its type, and never one that's taken", () => {
    expect(newNodeId("claude.worker", [])).toBe("worker");
    expect(newNodeId("claude.worker", ["worker"])).toBe("worker-2");
    expect(newNodeId("tool.gh", ["gh", "gh-2"])).toBe("gh-3");
  });

  it("names the nodes that act outside the worktree", () => {
    expect(actingOutside(graph)).toEqual(["a (tool.gh)", "c (mcp.call)"]);
  });

  it("says each card's problems in words", () => {
    const facts = factsOf(graph, [
      error(["nodes", "a", "command"]),
      error(["nodes", "a", "args"]),
      { ...error(["nodes", "c"]), severity: "warning" },
      error(["edges", 0]),
    ]);
    expect(facts.get("a")).toMatchObject({
      status: "failed",
      word: "2 errors",
    });
    expect(facts.get("b")?.word).toBe("no problems");
    expect(
      factsOf(graph, [{ ...error(["nodes", "a"]), code: "schema.x" }]).get("b")
        ?.word,
    ).toBe("not checked yet");
    expect(
      problemWords({
        ...error(["nodes", "gate", "question"]),
        message: "Invalid input: expected string, received undefined",
      }),
    ).toBe("Question is required.");
    expect(facts.get("c")?.word).toBe("1 warning");
  });

  it("finds the problems at exactly a path", () => {
    const here = error(["nodes", "a", "command"]);
    expect(problemsAt([here], ["nodes", "a", "command"])).toEqual([here]);
    expect(problemsAt([here], ["nodes", "a"])).toEqual([]);
  });
});
