/**
 * @file Tests for what the Monitor works out from a run's tree: the statuses,
 *   the cards, the rows, the spawned workers, and which controls apply and why
 *   not.
 */

import type { TreeNode } from "@krapht/ork-server/client";
import { describe, expect, it } from "vitest";

import {
  askingNodes,
  changesOf,
  factsOf,
  graphInputOf,
  nodeActions,
  rowsOf,
  runStatusOf,
  type Standing,
  runActions,
  statusOf,
} from "../../src/panels/monitor-model.ts";
import { runView } from "../state/fixtures.ts";
import { treeNode } from "./monitor-fixtures.ts";

const TREE: TreeNode[] = [
  treeNode("lead", {
    state: "running",
    children: [treeNode("lead-1", { parent: "lead" })],
  }),
  treeNode("after"),
];

const decision = (runId: string, node: string) => ({
  id: `${runId}-1`,
  runId,
  node,
  kind: "question" as const,
  question: "?",
  options: [],
  status: "open" as const,
  openedAt: "now",
});

describe("the Monitor's model", () => {
  it("says each node's status, with a pause or a question first", () => {
    expect(statusOf(treeNode("a"), false)).toBe("queued");
    expect(statusOf(treeNode("a", { state: "ok" }), false)).toBe("succeeded");
    expect(statusOf(treeNode("a", { state: "running" }), true)).toBe("waiting");
    expect(statusOf(treeNode("a"), false, true)).toBe("skipped");
    expect(statusOf(treeNode("a", { state: "running" }), false, true)).toBe(
      "interrupted",
    );
    expect(statusOf(treeNode("a", { state: "ok" }), false, true)).toBe(
      "succeeded",
    );
    expect(
      statusOf(treeNode("a", { state: "running", held: true }), true),
    ).toBe("paused");
  });

  it("finds the nodes of this run with a question open", () => {
    expect([
      ...askingNodes([decision("r", "a"), decision("other", "b")], "r"),
    ]).toEqual(["a"]);
    expect([...askingNodes(null, "r")]).toEqual([]);
  });

  it("gives each node's card its tokens, cost, model and command", () => {
    const facts = factsOf(
      [
        treeNode("a", {
          state: "ok",
          model: "opus",
          inputTokens: 10,
          outputTokens: 5,
          costUsd: 0.5,
        }),
        treeNode("b"),
      ],
      new Set(),
      "r1",
    );
    expect(facts.get("a")).toEqual({
      status: "succeeded",
      model: "opus",
      tokens: 15,
      costUsd: 0.5,
      cli: "ork logs r1 --node a",
    });
    expect(facts.get("b")).toMatchObject({
      tokens: undefined,
      costUsd: undefined,
    });
  });

  it("lists the tree as rows, leaving out what is closed", () => {
    expect(
      rowsOf(TREE).map(({ node, depth, parent }) => [node.id, depth, parent]),
    ).toEqual([
      ["lead", 1, undefined],
      ["lead-1", 2, "lead"],
      ["after", 1, undefined],
    ]);
    expect(rowsOf(TREE, new Set(["lead"])).map(({ node }) => node.id)).toEqual([
      "lead",
      "after",
    ]);
  });

  it("adds the workers a run has spawned to its graph", () => {
    const input = graphInputOf(
      {
        nodes: [
          { id: "lead", type: "claude.leader" },
          { id: "after", type: "tool.shell" },
        ],
        edges: [],
        channels: [],
      },
      TREE,
    );
    expect(input.nodes.map(node => node.id)).toEqual([
      "lead",
      "after",
      "lead-1",
    ]);
    expect(input.nodes[2]?.parent).toBe("lead");
  });
});

describe("which controls apply", () => {
  const running = runView("r1");
  const paused = runView("r1", "paused");
  const ended = runView("r1", "failed");

  it("for a running run: pause and stop, not continue", () => {
    expect(runActions(running)).toEqual({
      pause: { enabled: true },
      proceed: { enabled: false, why: "the run is not paused" },
      stop: { enabled: true },
    });
  });

  it("for a paused run: continue and stop, not pause", () => {
    expect(runActions(paused)).toEqual({
      pause: { enabled: false, why: "the run is paused" },
      proceed: { enabled: true },
      stop: { enabled: true },
    });
  });

  it("for a run that has ended: only resume, and it says why not the rest", () => {
    const why = "the run has ended (failed)";
    expect(runActions(ended)).toEqual({
      pause: { enabled: false, why },
      proceed: { enabled: false, why },
      stop: { enabled: false, why },
      resume: { enabled: true },
    });
  });

  it("for a run that succeeded: nothing, not even resume", () => {
    expect(runActions(runView("r", "succeeded"))).not.toHaveProperty("resume");
  });

  it("for a run of one node: resume, saying why not", () => {
    expect(runActions(runView("node-r", "failed")).resume).toEqual({
      enabled: false,
      why: "it ran one node; run that node again instead",
    });
  });

  it("for a running node: pause and stop", () => {
    expect(nodeActions(running, treeNode("a", { state: "running" }))).toEqual({
      pause: { enabled: true },
      proceed: { enabled: false, why: "a is not paused" },
      stop: { enabled: true },
    });
  });

  it("for a held node: continue and stop", () => {
    expect(
      nodeActions(running, treeNode("a", { state: "running", held: true })),
    ).toEqual({
      pause: { enabled: false, why: "a is paused" },
      proceed: { enabled: true },
      stop: { enabled: true },
    });
  });

  it("for a node waiting its turn: pause, but nothing to stop", () => {
    expect(nodeActions(running, treeNode("a"))).toMatchObject({
      pause: { enabled: true },
      stop: { enabled: false, why: "a is not running" },
    });
  });

  it("for a finished node: nothing", () => {
    const why = "a has finished";
    expect(nodeActions(running, treeNode("a", { state: "ok" }))).toEqual({
      pause: { enabled: false, why },
      proceed: { enabled: false, why },
      stop: { enabled: false, why },
    });
  });

  it("in a run paused as a whole, a node defers to the run", () => {
    const why = "the whole run is paused; continue the run";
    expect(nodeActions(paused, treeNode("a", { state: "running" }))).toEqual({
      pause: { enabled: false, why },
      proceed: { enabled: false, why },
      stop: { enabled: true },
    });
  });
});

const standing = (
  run: Standing["run"],
  nodes: Record<string, Standing["run"]>,
): Standing => ({ run, nodes: new Map(Object.entries(nodes)) });

describe("what is said aloud", () => {
  it("says the run going on again, and leaves its ending to notifications", () => {
    expect(
      changesOf("r1", standing("paused", {}), standing("running", {})),
    ).toEqual(["Run r1 running."]);
    expect(
      changesOf("r1", standing("running", {}), standing("succeeded", {})),
    ).toEqual([]);
  });

  it("says a node that failed or paused, but not one a question holds", () => {
    expect(
      changesOf(
        "r1",
        standing("running", { a: "running", b: "running", c: "running" }),
        standing("running", { a: "failed", b: "waiting", c: "paused" }),
      ),
    ).toEqual(["a failed.", "c paused."]);
  });

  it("leaves out routine changes, and what has not changed", () => {
    expect(
      changesOf(
        "r1",
        standing("running", { a: "queued", b: "failed" }),
        standing("running", { a: "running", b: "failed" }),
      ),
    ).toEqual([]);
  });

  it("says nothing of each node when the whole run pauses", () => {
    expect(
      changesOf(
        "r1",
        standing("running", { a: "running" }),
        standing("paused", { a: "paused" }),
      ),
    ).toEqual([]);
  });
});

describe("a run's status in the header", () => {
  it("reads a running run with a question open as waiting", () => {
    expect(runStatusOf({ live: "running" }, true)).toBe("waiting");
    expect(runStatusOf({ live: "running" }, false)).toBe("running");
    expect(runStatusOf({ live: "failed" }, true)).toBe("failed");
  });
});
