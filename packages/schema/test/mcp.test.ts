/**
 * @file Tests for the `mcp` field: it parses on a leader, a worker and
 *   `defaults`, and nowhere else.
 */

import { describe, expect, it } from "vitest";

import { parseProject, parseWorkflow } from "../src/index.ts";

const parses = (node: string, top = ""): boolean =>
  parseWorkflow(
    ["schemaVersion: 1", "name: t", top, "nodes:", `  n: ${node}`].join("\n"),
  ).ok;

describe("mcp", () => {
  it.each(["agent.leader", "agent.worker"])("parses on %s", type => {
    expect(parses(`{ type: ${type}, prompt: Go, mcp: [a, b] }`)).toBe(true);
  });

  it("parses on a workflow's defaults", () => {
    expect(
      parses("{ type: agent.worker, prompt: Go }", "defaults: { mcp: [a] }"),
    ).toBe(true);
  });

  it("parses on a project's defaults", () => {
    expect(parseProject("schemaVersion: 1\ndefaults: { mcp: [a] }\n").ok).toBe(
      true,
    );
  });

  it("parses as an empty list, which turns defaults off", () => {
    expect(parses("{ type: agent.worker, prompt: Go, mcp: [] }")).toBe(true);
  });

  it.each(["[1]", "a", '[""]'])("is rejected as %s", value => {
    expect(parses(`{ type: agent.worker, prompt: Go, mcp: ${value} }`)).toBe(
      false,
    );
  });

  it("is rejected on a node that has no session of its own", () => {
    expect(
      parses(
        "{ type: agent.subagent, parent: p, description: d, prompt: Go, mcp: [a] }",
      ),
    ).toBe(false);
  });

  it("is rejected on a tool node", () => {
    expect(parses("{ type: tool.shell, command: x, mcp: [a] }")).toBe(false);
  });
});
