/**
 * @file Tests for `ork validate`'s check of a `workflow.call` against what it
 *   calls: a project not registered here warns, and a missing workflow, node or
 *   required input is an error.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { Node, Workflow } from "@krapht/ork-schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { checkCallTargets } from "../src/index.ts";

const FEATURE = `schemaVersion: 1
name: feature
inputs:
  must: { type: string, required: true }
  may: { type: string }
nodes:
  builder: { type: agent.worker, prompt: b }
  tool: { type: tool.shell, command: "true" }
`;

type Call = Partial<Extract<Node, { type: "workflow.call" }>>;

const calling = (over: Call): Workflow => ({
  schemaVersion: 1,
  name: "caller",
  nodes: {
    kit: {
      type: "workflow.call",
      workflow: "feature",
      inputs: { must: "x" },
      ...over,
    },
  },
});

describe("checking what a call names", () => {
  let dir: string;
  let own: { id: string; root: string; dir: string; mode: "in-repo" };

  const codesOf = (over: Call): string[] =>
    checkCallTargets(calling(over), own, [own]).map(
      d => `${d.severity}:${d.code}`,
    );

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ork-call-targets-"));
    const orkDir = path.join(dir, ".ork");
    mkdirSync(path.join(orkDir, "workflows"), { recursive: true });
    writeFileSync(path.join(orkDir, "workflows/feature.ork.yaml"), FEATURE);
    writeFileSync(path.join(orkDir, "workflows/broken.ork.yaml"), "nodes: 3");
    own = { id: "own", root: dir, dir: orkDir, mode: "in-repo" };
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("accepts a call that matches", () => {
    expect(codesOf({})).toEqual([]);
    expect(codesOf({ project: "own", node: "builder" })).toEqual([]);
  });

  it("only warns about a project not registered here", () => {
    expect(codesOf({ project: "elsewhere" })).toEqual(["warning:call.project"]);
  });

  it("refuses a workflow that is missing or not valid", () => {
    expect(codesOf({ workflow: "ghost" })).toEqual(["error:call.workflow"]);
    expect(codesOf({ workflow: "broken" })).toEqual(["error:call.workflow"]);
  });

  it("refuses a name that walks out of the workflows folder", () => {
    expect(codesOf({ workflow: "../../feature" })).toEqual([
      "error:call.workflow",
    ]);
  });

  it("refuses a node that is no leader or worker of it", () => {
    expect(codesOf({ node: "ghost" })).toEqual(["error:call.node"]);
    expect(codesOf({ node: "tool" })).toEqual(["error:call.node"]);
  });

  it("refuses a call that leaves out a required input", () => {
    expect(codesOf({ inputs: {} })).toEqual(["error:call.input"]);
  });

  it("leaves a name with a template to the run", () => {
    expect(codesOf({ workflow: "{{inputs.which}}" })).toEqual([]);
    expect(codesOf({ project: "{{inputs.where}}" })).toEqual([]);
  });
});
