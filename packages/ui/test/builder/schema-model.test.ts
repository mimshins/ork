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
      "agent.leader",
      "agent.worker",
      "agent.subagent",
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
      "agent.leader.before.output.schema.*.list.*[]",
      "agent.leader.before.output.schema.*[]",
      "agent.leader.output.schema.*",
      "agent.leader.output.schema.*.list.*[]",
      "agent.leader.verify.output.schema.*.list.*[]",
      "agent.leader.verify.output.schema.*[]",
      "agent.subagent.output.schema.*",
      "agent.subagent.output.schema.*.list.*[]",
      "agent.worker.before.output.schema.*.list.*[]",
      "agent.worker.before.output.schema.*[]",
      "agent.worker.forEach.items[]",
      "agent.worker.output.schema.*",
      "agent.worker.output.schema.*.list.*[]",
      "agent.worker.verify.output.schema.*.list.*[]",
      "agent.worker.verify.output.schema.*[]",
      "mcp.call.arguments.*",
      "mcp.call.forEach.items[]",
      "mcp.call.output.schema.*.list.*[]",
      "mcp.call.output.schema.*[]",
      "tool.aws.forEach.items[]",
      "tool.aws.output.schema.*.list.*[]",
      "tool.aws.output.schema.*[]",
      "tool.gh.forEach.items[]",
      "tool.gh.output.schema.*.list.*[]",
      "tool.gh.output.schema.*[]",
      "tool.git.forEach.items[]",
      "tool.git.output.schema.*.list.*[]",
      "tool.git.output.schema.*[]",
      "tool.shell.forEach.items[]",
      "tool.shell.output.schema.*.list.*[]",
      "tool.shell.output.schema.*[]",
      "workflow.call.forEach.items[]",
    ]);
  });

  it("has a control for every top-level setting, agents included", () => {
    expect(freeTopLevel().toSorted()).toEqual([
      "workflow.agents.*.output.schema.*",
      "workflow.agents.*.output.schema.*.list.*[]",
      "workflow.defaults.before.output.schema.*.list.*[]",
      "workflow.defaults.before.output.schema.*[]",
      "workflow.inputs.*.default",
    ]);
  });
});

/** A named field of an object schema. */
const fieldOf = (schema: JsonSchema | undefined, key: string) => {
  const kind = schema === undefined ? undefined : kindOf(schema);
  return kind?.kind === "object"
    ? kind.fields.find(field => field.key === key)?.schema
    : undefined;
};

/** The names of an object schema's fields. */
const keysOf = (schema: JsonSchema): string[] => {
  const kind = kindOf(schema);
  return kind.kind === "object" ? kind.fields.map(field => field.key) : [];
};

/** What a schema is, as the builder reads it; a missing schema is `none`. */
const kindName = (schema: JsonSchema | undefined): string =>
  schema === undefined ? "none" : kindOf(schema).kind;

/** The schema every value of a record has. */
const recordValue = (
  schema: JsonSchema | undefined,
): JsonSchema | undefined => {
  const kind = schema === undefined ? undefined : kindOf(schema);
  return kind?.kind === "record" ? kind.value : undefined;
};

/** The schemas a field chooses between. */
const variantsOf = (schema: JsonSchema | undefined): readonly JsonSchema[] => {
  const kind = schema === undefined ? undefined : kindOf(schema);
  return kind?.kind === "variants" ? kind.variants : [];
};

describe("forEach (RFC-013)", () => {
  const node = nodeSchemaOf(ROOT, "tool.shell");

  it("is a group with a choice between a list and a source", () => {
    const forEach = fieldOf(node, "forEach");
    expect(kindName(forEach)).toBe("variants");
    expect(variantsOf(forEach).map(variant => keysOf(variant))).toEqual([
      ["items", "maxParallel", "onFailure"],
      ["from", "maxItems", "maxParallel", "onFailure"],
    ]);
  });

  it("reads a declared list's item shape as named values", () => {
    const declared = fieldOf(fieldOf(node, "output"), "schema");
    const rules = variantsOf(recordValue(declared));
    const list = rules.find(rule => keysOf(rule).includes("list"));
    expect(kindName(fieldOf(list, "list"))).toBe("record");
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
      { id: "b", type: "agent.worker" },
      { id: "c", type: "mcp.call" },
    ],
    edges: [],
    channels: [],
  };

  it("names a new node after its type, and never one that's taken", () => {
    expect(newNodeId("agent.worker", [])).toBe("worker");
    expect(newNodeId("agent.worker", ["worker"])).toBe("worker-2");
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
