/**
 * @file Tests for Ork's harness instructions: every Claude node's session is
 *   told it is one step of a workflow, so a project's own agent process (its
 *   role agents, review gates, commits) stays with the nodes that run it.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseWorkflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import { planNodeSession } from "../src/index.ts";

const parsed = parseWorkflow(
  [
    "schemaVersion: 1",
    "name: h",
    "nodes:",
    "  lead: { type: agent.leader, instructions: Lead the work. }",
    "  build: { type: agent.worker, parent: lead, prompt: b }",
    "  solo: { type: agent.worker, prompt: s, practices: { caveman: false, ponytail: false } }",
  ].join("\n"),
);
if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
const WORKFLOW = parsed.workflow;

/** A node's appended system prompt, planned in a fresh folder. */
const systemAppend = (id: string): string => {
  const cwd = mkdtempSync(path.join(tmpdir(), "ork-harness-"));
  const result = planNodeSession(WORKFLOW, id, {
    cwd,
    inputs: {},
    inPlace: true,
  });
  if (!result.ok) throw new Error(result.error);
  return result.spec.systemAppend;
};

const STEP = [
  "This session is one node of an Ork workflow: do only your node's step.",
  "Never start another step's role agent (a documenter, implementer, reviewer or PR shepherd) yourself, as a subagent or otherwise; only sub-agent nodes you own are yours to start.",
  "Human gates (a review of the diff, an approval, the choice to commit or open a pull request) are not yours: don't wait for them, ask for them, or treat them as done.",
  "Ask with `ask_user`",
  "Never stage, commit, push or post (a pull request, a comment, a review) unless your brief or these instructions say this node does.",
];

describe("the harness instructions", () => {
  it.each(["lead", "build", "solo"])(
    "tell %s it is one step of a workflow",
    id => {
      const text = systemAppend(id);
      const ork = text.slice(text.indexOf("# Ork"));
      for (const line of STEP) expect(ork).toContain(line);
    },
  );

  it("come before the node's own instructions", () => {
    const text = systemAppend("lead");
    expect(text.indexOf("only your node's step")).toBeLessThan(
      text.indexOf("Lead the work."),
    );
  });
});
