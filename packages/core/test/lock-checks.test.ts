/**
 * @file Tests for the compiler's checks on a node's `lock` (RFC-016): the name
 *   is a template that reads only the inputs, and the node carries it.
 */

import { parseWorkflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import { compileWorkflow } from "../src/index.ts";

const compiled = (lock: string) => {
  const parsed = parseWorkflow(
    [
      "schemaVersion: 1",
      "name: t",
      "inputs:",
      "  branch: { type: string }",
      "nodes:",
      "  plan:",
      "    type: tool.shell",
      "    command: plan",
      "  push:",
      "    type: tool.shell",
      "    command: push",
      `    lock: ${lock}`,
      "edges:",
      "  - plan -> push",
    ].join("\n"),
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return compileWorkflow(parsed.workflow);
};

describe("lock checks", () => {
  it("carries the lock on the compiled node", () => {
    const result = compiled("'branch:{{inputs.branch}}'");
    expect(result.diagnostics).toEqual([]);
    expect(result.graph?.nodes.get("push")?.node).toMatchObject({
      lock: "branch:{{inputs.branch}}",
    });
  });

  it("refuses a template that doesn't parse", () => {
    const codes = compiled("'a:{{inputs.'").diagnostics.map(d => d.code);
    expect(codes).toContain("template.syntax");
  });

  it("refuses an input that doesn't exist", () => {
    const codes = compiled("'a:{{inputs.nope}}'").diagnostics.map(d => d.code);
    expect(codes).toHaveLength(1);
  });

  it("refuses reading another node's output", () => {
    const found = compiled("'a:{{nodes.plan.output.x}}'").diagnostics.find(
      d => d.code === "lock.scope",
    );
    expect(found?.path).toEqual(["nodes", "push", "lock"]);
  });

  it("refuses reading the run, which orders nothing", () => {
    const { diagnostics } = compiled("'branch:{{run.id}}'");
    expect(diagnostics.map(d => d.code)).toEqual(["lock.scope"]);
    expect(diagnostics[0]?.path).toEqual(["nodes", "push", "lock"]);
  });

  it("reports a node's output once", () => {
    const codes = compiled("'a:{{nodes.plan.output.x}}'").diagnostics.map(
      d => d.code,
    );
    expect(codes.filter(code => code === "lock.scope")).toHaveLength(1);
  });

  it.each(["item", "index"])("leaves {{%s}} to item.outside alone", name => {
    const codes = compiled(`'a:{{${name}}}'`).diagnostics.map(d => d.code);
    expect(codes).toEqual(["item.outside"]);
  });
});
