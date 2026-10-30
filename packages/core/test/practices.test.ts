/**
 * @file Tests for Ork's built-in practices: how a node's caveman and ponytail
 *   settings cascade down the ownership tree, and how they reach the session's
 *   system prompt unless the project ships the same skill.
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
  "  lead: { type: claude.leader, practices: { caveman: false } }",
  "  review: { type: claude.worker, parent: lead, practices: { ponytail: ultra } }",
  "  helper: { type: claude.subagent, parent: review, description: helps }",
  "  solo: { type: claude.worker }",
  "  quiet: { type: claude.worker, practices: { caveman: false, ponytail: false } }",
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
        workflow(["nodes:", "  a: { type: claude.worker }"]),
        "a",
      ),
    ).toEqual({
      caveman: true,
      ponytail: "full",
    });
    expect(resolvePractices(TREE, "lead")).toEqual({
      caveman: false,
      ponytail: "lite",
    });
    expect(resolvePractices(TREE, "review")).toEqual({
      caveman: false,
      ponytail: "ultra",
    });
    expect(resolvePractices(TREE, "helper")).toEqual({
      caveman: false,
      ponytail: "ultra",
    });
    expect(resolvePractices(TREE, "solo")).toEqual({
      caveman: true,
      ponytail: "lite",
    });
    expect(resolvePractices(TREE, "quiet")).toEqual({
      caveman: false,
      ponytail: false,
    });
  });

  it("round-trip through the workflow file", () => {
    const text = serializeWorkflow(TREE);
    expect(text).toContain("practices:\n      caveman: false");
    expect(serializeWorkflow(reparse(text))).toBe(text);
  });

  it("go into the system prompt, unless the project ships the same skill", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "ork-practices-"));
    const on = { caveman: true, ponytail: "ultra" } as const;
    const first = practiceInstructions(on, cwd);
    expect(first.text).toHaveLength(2);
    expect(first.text[1]).toContain("Level: ultra.");

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
    expect(systemAppend(cwd, "quiet").startsWith("# Ork")).toBe(true);
  });
});
