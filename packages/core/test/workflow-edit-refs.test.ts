/**
 * @file The builder's rename against the real compiler (RFC-008): renaming
 *   every node of every example leaves a workflow that compiles the same, so no
 *   reference to a node's id was missed.
 */

import { readFileSync } from "node:fs";

import { applyEdits, parseWorkflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import { compileWorkflow } from "../src/index.ts";

const EXAMPLES = [
  "across-projects",
  "checked-build",
  "pr-review",
  "software-factory",
];

const read = (name: string): string =>
  readFileSync(
    new URL(`../../../examples/${name}.ork.yaml`, import.meta.url),
    "utf8",
  );

const parsed = (text: string) => {
  const result = parseWorkflow(text);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.workflow;
};

const edited = (text: string, edits: Parameters<typeof applyEdits>[1]) => {
  const result = applyEdits(text, edits);
  if (!result.ok) throw new Error(result.message);
  return result.text;
};

const codes = (text: string): string[] =>
  compileWorkflow(parsed(text))
    .diagnostics.map(d => `${d.severity} ${d.code}`)
    .toSorted();

describe("renaming every node", () => {
  it.each(EXAMPLES)("%s compiles the same", name => {
    const text = read(name);
    const ids = Object.keys(parsed(text).nodes);
    const moved = edited(
      text,
      ids.map(id => ({ op: "renameNode", from: id, to: `moved-${id}` })),
    );
    expect(codes(moved)).toEqual(codes(text));
    expect(Object.keys(parsed(moved).nodes)).toEqual(
      ids.map(id => `moved-${id}`),
    );
    expect(moved).not.toMatch(/\{\{\s*nodes\.(?!moved-)/u);
  });
});

describe("removing a node", () => {
  it.each(EXAMPLES)("%s still parses without any one of them", name => {
    const text = read(name);
    const ids = Object.keys(parsed(text).nodes);
    const left = ids.map(id =>
      Object.keys(parsed(edited(text, [{ op: "removeNode", id }])).nodes),
    );
    expect(left.map(nodes => nodes.length)).toEqual(
      ids.map(() => ids.length - 1),
    );
  });
});
