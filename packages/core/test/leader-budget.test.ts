/**
 * @file Tests for the `budget.leader` warning: a run budget, a leader with
 *   children, and no cap of its own in that unit (ADR-077: its reserve is never
 *   waited on, so its workers are refused).
 */

import { parseWorkflow, type Project } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import { compileWorkflow } from "../src/index.ts";

/** The `budget.leader` diagnostics of a workflow with a leader `lead`. */
const found = (top: string, lead = "", child = true, project?: Project) => {
  const parsed = parseWorkflow(
    `schemaVersion: 1\nname: t\n${top}nodes:\n  lead:\n    type: agent.leader\n    prompt: p\n${lead}${child ? "  w:\n    type: agent.worker\n    parent: lead\n    prompt: p\n" : ""}`,
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  const options = project === undefined ? {} : { project };
  return compileWorkflow(parsed.workflow, options).diagnostics.filter(
    d => d.code === "budget.leader",
  );
};

describe("budget.leader", () => {
  it("warns for each run budget the leader has no cap in", () => {
    const warned = found("limits:\n  budgetUsd: 5\n  budgetTokens: 400\n");
    expect(warned.map(d => [d.severity, d.path])).toEqual([
      ["warning", ["nodes", "lead"]],
      ["warning", ["nodes", "lead"]],
    ]);
    expect(warned.map(d => d.message)).toEqual([
      expect.stringContaining("no budgetUsd of its own"),
      expect.stringContaining("no budgetTokens of its own"),
    ]);
  });

  it("is quiet when the leader or defaults set a cap in that unit", () => {
    expect(
      found("limits:\n  budgetTokens: 400\n", "    budgetTokens: 1\n"),
    ).toEqual([]);
    expect(
      found("defaults:\n  budgetUsd: 1\nlimits:\n  budgetUsd: 5\n"),
    ).toEqual([]);
  });

  it("counts the project's defaults as the leader's cap, in their unit only", () => {
    const project: Project = {
      schemaVersion: 1,
      defaults: { budgetUsd: 1 },
    };
    const top = "limits:\n  budgetUsd: 5\n  budgetTokens: 400\n";
    expect(found(top, "", true).map(d => d.message)).toHaveLength(2);
    expect(found(top, "", true, project).map(d => d.message)).toEqual([
      expect.stringContaining("no budgetTokens of its own"),
    ]);
  });

  it("warns only in the unit the leader leaves open", () => {
    expect(
      found(
        "limits:\n  budgetUsd: 5\n  budgetTokens: 400\n",
        "    budgetUsd: 1\n",
      ).map(d => d.message),
    ).toEqual([expect.stringContaining("no budgetTokens of its own")]);
  });

  it("is quiet with no run budget, or a leader with no children", () => {
    expect(found("")).toEqual([]);
    expect(found("limits:\n  budgetUsd: 5\n", "", false)).toEqual([]);
  });
});
