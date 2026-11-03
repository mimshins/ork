/** @file Tests for reading a workflow file as the graph the UI draws. */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readWorkflowGraph, runGraph } from "../src/index.ts";

const WORKFLOW = `schemaVersion: 1
name: t
nodes:
  lead: { type: claude.leader, prompt: l }
  a: { type: claude.worker, parent: lead, prompt: a }
  b: { type: tool.shell, command: "true" }
edges:
  - lead -> a, b
  - { from: b, to: lead, when: "exitCode == 1", maxRounds: 2 }
messages:
  - between: [a, lead]
`;

describe("reading a workflow's graph", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ork-graph-"));
    file = path.join(dir, "t.ork.yaml");
    writeFileSync(file, WORKFLOW);
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("gives its nodes, expanded edges and channels", () => {
    expect(readWorkflowGraph(file)).toMatchObject({
      nodes: [
        { id: "lead", type: "claude.leader" },
        { id: "a", type: "claude.worker", parent: "lead" },
        { id: "b", type: "tool.shell" },
      ],
      edges: [
        { from: "lead", to: "a" },
        { from: "lead", to: "b" },
        { from: "b", to: "lead", when: "exitCode == 1", maxRounds: 2 },
      ],
      channels: [["a", "lead"]],
      positions: {},
    });
  });

  it("takes positions from the layout file beside it", () => {
    writeFileSync(
      path.join(dir, "t.layout.json"),
      JSON.stringify({ nodes: { lead: { x: 10, y: 20 } } }),
    );
    expect(readWorkflowGraph(file)?.positions).toEqual({
      lead: { x: 10, y: 20 },
    });
  });

  it("treats a broken layout file as none", () => {
    writeFileSync(path.join(dir, "t.layout.json"), "{ not json");
    expect(readWorkflowGraph(file)?.positions).toEqual({});
    writeFileSync(path.join(dir, "t.layout.json"), '{"nodes":{"a":{"x":"1"}}}');
    expect(readWorkflowGraph(file)?.positions).toEqual({});
  });

  it("says when there is no workflow to read", () => {
    expect(readWorkflowGraph(path.join(dir, "gone.ork.yaml"))).toBeNull();
    writeFileSync(file, "nodes: 3");
    expect(readWorkflowGraph(file)).toBeNull();
  });

  it("draws a run from what it recorded, whatever the file says now", () => {
    const graph = runGraph(
      [
        {
          type: "run.started",
          runId: "r",
          workflow: "t",
          entries: [],
          nodes: [{ id: "old", type: "tool.shell" }],
          edges: [{ from: "old", to: "old", maxRounds: 2 }],
          channels: [],
        },
      ],
      file,
    );
    expect(graph.nodes.map(node => node.id)).toEqual(["old"]);
    expect(graph.edges).toEqual([{ from: "old", to: "old", maxRounds: 2 }]);
    expect(graph.channels).toEqual([]);
  });

  it("goes by the file for a run from before edges were kept", () => {
    const graph = runGraph(
      [
        {
          type: "run.started",
          runId: "r",
          workflow: "t",
          entries: [],
          nodes: [{ id: "lead", type: "claude.leader" }],
        },
      ],
      file,
    );
    expect(graph.nodes.map(node => node.id)).toEqual(["lead"]);
    expect(graph.edges).toHaveLength(3);
    expect(graph.channels).toEqual([["a", "lead"]]);
  });

  it("still shows a run whose file has gone", () => {
    expect(
      runGraph(
        [
          {
            type: "run.started",
            runId: "r",
            workflow: "t",
            entries: [],
            nodes: [{ id: "lead", type: "claude.leader" }],
          },
        ],
        path.join(dir, "gone.ork.yaml"),
      ),
    ).toMatchObject({ edges: [], channels: [], positions: {} });
  });
});
