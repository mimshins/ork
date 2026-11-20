/**
 * @file Tests for Ork's built-in practices: how a node's caveman, ponytail and
 *   quiet settings cascade down the ownership tree, and how they reach the
 *   session's system prompt unless the project ships the same skill.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseWorkflow, serializeWorkflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import {
  CAVEMAN,
  planNodeSession,
  practiceInstructions,
  QUIET,
  resolvePractices,
} from "../src/index.ts";

const workflow = (yaml: string[]) => {
  const parsed = parseWorkflow(
    ["schemaVersion: 1", "name: p", ...yaml].join("\n"),
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return parsed.workflow;
};

const reparse = (text: string) => {
  const parsed = parseWorkflow(text);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return parsed.workflow;
};

const TREE = workflow([
  "defaults:",
  "  practices: { ponytail: lite }",
  "nodes:",
  "  lead: { type: agent.leader, practices: { caveman: false } }",
  "  review: { type: agent.worker, parent: lead, practices: { ponytail: ultra } }",
  "  helper: { type: agent.subagent, parent: review, description: helps }",
  "  solo: { type: agent.worker }",
  "  hush: { type: agent.worker, practices: { caveman: false, ponytail: false, quiet: false } }",
  "  loud: { type: agent.leader, practices: { quiet: false } }",
  "  loud-kid: { type: agent.worker, parent: loud }",
]);

/** A node's appended system prompt, planned in `cwd`. */
const systemAppend = (cwd: string, id: string): string => {
  const result = planNodeSession(TREE, id, { cwd, inputs: {}, inPlace: true });
  if (!result.ok) throw new Error(result.error);
  return result.spec.systemAppend;
};

describe("practices", () => {
  it("are on by default and cascade from owners, then defaults", () => {
    expect(
      resolvePractices(
        workflow(["nodes:", "  a: { type: agent.worker }"]),
        "a",
      ),
    ).toEqual({
      caveman: true,
      ponytail: "full",
      quiet: true,
    });
    expect(resolvePractices(TREE, "lead")).toEqual({
      caveman: false,
      ponytail: "lite",
      quiet: true,
    });
    expect(resolvePractices(TREE, "review")).toEqual({
      caveman: false,
      ponytail: "ultra",
      quiet: true,
    });
    expect(resolvePractices(TREE, "helper")).toEqual({
      caveman: false,
      ponytail: "ultra",
      quiet: true,
    });
    expect(resolvePractices(TREE, "solo")).toEqual({
      caveman: true,
      ponytail: "lite",
      quiet: true,
    });
    expect(resolvePractices(TREE, "hush")).toEqual({
      caveman: false,
      ponytail: false,
      quiet: false,
    });
  });

  it("turn quiet off for a node, its owned nodes, or the defaults", () => {
    expect(resolvePractices(TREE, "loud-kid").quiet).toBe(false);
    const off = workflow([
      "defaults:",
      "  practices: { quiet: false }",
      "nodes:",
      "  a: { type: agent.worker }",
      "  b: { type: agent.worker, practices: { quiet: true } }",
    ]);
    expect(resolvePractices(off, "a").quiet).toBe(false);
    expect(resolvePractices(off, "b").quiet).toBe(true);
  });

  it("round-trip through the workflow file", () => {
    const text = serializeWorkflow(TREE);
    expect(text).toContain("practices:\n      caveman: false");
    expect(serializeWorkflow(reparse(text))).toBe(text);
  });

  it("go into the system prompt, unless the project ships the same skill", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "ork-practices-"));
    const on = { caveman: true, ponytail: "ultra", quiet: true } as const;
    const first = practiceInstructions(on, cwd);
    expect(first.text).toHaveLength(3);
    expect(first.text[1]).toContain("Level: ultra.");
    expect(first.text[2]).toBe(QUIET);
    expect(QUIET).toMatch(/file of the repository/u);
    expect(QUIET).toMatch(/commit messages/u);
    expect(QUIET).toMatch(/pull request titles and bodies/u);
    expect(QUIET).toMatch(/Ork's own folder/u);
    expect(
      practiceInstructions({ ...on, quiet: false }, cwd).text,
    ).toHaveLength(2);

    mkdirSync(path.join(cwd, ".claude/skills/caveman"), { recursive: true });
    writeFileSync(
      path.join(cwd, ".claude/skills/caveman/SKILL.md"),
      "# caveman\n",
    );
    const second = practiceInstructions(on, cwd);
    expect(second.skipped).toEqual(["caveman"]);
    expect(second.text.join("\n")).not.toContain("Practice: caveman");
  });

  it("lead the session's appended system prompt", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "ork-practices-"));
    expect(systemAppend(cwd, "solo").startsWith(CAVEMAN)).toBe(true);
    expect(systemAppend(cwd, "lead").startsWith("## Practice: ponytail")).toBe(
      true,
    );
    expect(systemAppend(cwd, "hush").startsWith("# Ork")).toBe(true);
  });

  it("put quiet after caveman and ponytail, unless it is off", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "ork-practices-"));
    const solo = systemAppend(cwd, "solo");
    expect(solo.indexOf(QUIET)).toBeGreaterThan(solo.indexOf("Level: lite."));
    expect(systemAppend(cwd, "loud-kid")).not.toContain("Practice: quiet");
  });
});
