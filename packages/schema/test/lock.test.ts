/**
 * @file Tests for a node's `lock` (RFC-016): which nodes take it, what a name
 *   may be, and the canonical round trip.
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

describe("lock", () => {
  it.each([
    "{ type: tool.shell, command: ls, lock: 'branch:{{inputs.branch}}' }",
    "{ type: tool.git, command: status, lock: main }",
    "{ type: agent.worker, lock: main }",
    "{ type: mcp.call, server: s, tool: t, lock: main }",
  ])("is taken by %s", node => {
    expect(parses(node)).toBe(true);
  });

  it.each([
    "{ type: agent.leader, lock: main }",
    "{ type: human.gate, question: q, options: [a, b], lock: main }",
  ])("is refused by %s", node => {
    expect(parses(node)).toBe(false);
  });

  it.each(["''", "'  '", "1", "true", "[a]", "{ a: b }", "null"])(
    "refuses %s as a name",
    value => {
      expect(parses(`{ type: tool.shell, command: ls, lock: ${value} }`)).toBe(
        false,
      );
    },
  );

  it("round-trips and places it after notify, before forEach", () => {
    const text = [
      "schemaVersion: 1",
      "name: t",
      "nodes:",
      "  n:",
      "    forEach: { items: [1] }",
      "    lock: 'branch:{{inputs.branch}}'",
      "    command: ls",
      "    type: tool.shell",
    ].join("\n");
    const [once, again] = roundTrip(text);
    expect(once).toMatch(/command: ls\n\s+lock: .*\n\s+forEach:/u);
    expect(again).toBe(once);
  });
});
