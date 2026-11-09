/**
 * @file Tests for a node with `forEach` in the Monitor's model and the Logs
 *   filter: its progress text, one card for the node and rows for its items,
 *   and the node filter that keeps a node's items with it.
 */

import type { StoredEvent, TreeNode } from "@krapht/ork-server/client";
import { describe, expect, it } from "vitest";

import type { Status } from "../../src/components/status-badge.tsx";
import { nodeName } from "../../src/graph/facts.ts";
import {
  filterEvents,
  NO_FILTERS,
  nodeOption,
  nodesIn,
} from "../../src/panels/logs-model.ts";
import {
  factsOf,
  graphInputOf,
  progressText,
  rowsOf,
} from "../../src/panels/monitor-model.ts";
import { nowLine } from "../../src/panels/node-table.ts";
import { treeNode } from "./monitor-fixtures.ts";

const item = (index: number, state: TreeNode["state"]): TreeNode =>
  treeNode(`build.${String(index)}`, { template: "build", state });

const fanned = (items: TreeNode[], over: Partial<TreeNode> = {}): TreeNode =>
  treeNode("build", {
    state: "running",
    listed: 8,
    children: items,
    ...over,
  });

const progressOfTree = (root: TreeNode): string | undefined =>
  factsOf([root], new Set(), "r").get("build")?.progress;

const noStatus = (): Status | undefined => undefined;

describe("a node with forEach", () => {
  it("reads its progress, with failures in words", () => {
    const root = fanned([
      item(0, "ok"),
      item(1, "failed"),
      item(2, "skipped"),
      item(3, "running"),
    ]);
    expect(progressOfTree(root)).toBe("3 of 8, 1 failed");
    expect(progressText(1, 8, 0)).toBe("1 of 8");
    expect(progressText(0, 0, 0)).toBe("0 of 0");
  });

  it("gives up its of for a slash when it would be long", () => {
    expect(progressText(120, 400, 11)).toBe("120/400, 11 failed");
    expect(progressText(12, 40, 1)).toBe("12 of 40, 1 failed");
  });

  it("is an ordinary card before it has listed, and in an old run", () => {
    const root = treeNode("build", {
      state: "running",
      children: [item(0, "ok")],
    });
    expect(progressOfTree(root)).toBeUndefined();
  });

  it("counts only the items inside its latest list", () => {
    const root = fanned([item(0, "ok"), item(1, "ok"), item(2, "failed")], {
      listed: 2,
    });
    expect(progressOfTree(root)).toBe("2 of 2");
  });

  it("names its status, then its progress, as the card shows them", () => {
    const facts = factsOf([fanned([item(0, "ok")])], new Set(), "r").get(
      "build",
    );
    expect(facts).toBeDefined();
    expect(
      nodeName("build", "claude.worker", { ...facts, status: "running" }),
    ).toBe("build, running, 1 of 8, worker");
  });

  it("says its progress in the table's now column, with why it failed", () => {
    const node = fanned([], { state: "failed", now: "2 items failed" });
    expect(nowLine(node, "failed", [], noStatus, 0, "3 of 8")).toBe(
      "3 of 8 · 2 items failed",
    );
    expect(nowLine(node, "running", [], noStatus, 0, "3 of 8")).toBe("3 of 8");
  });

  it("lists its items as rows, by index, not text order", () => {
    const root = fanned([item(10, "ok"), item(2, "ok"), item(0, "ok")]);
    expect(rowsOf([root]).map(({ node }) => node.id)).toEqual([
      "build",
      "build.0",
      "build.2",
      "build.10",
    ]);
    expect(rowsOf([root])[1]?.parent).toBe("build");
  });

  it("keeps items that arrive as roots, as before", () => {
    const rows = rowsOf([treeNode("build"), item(0, "ok")]);
    expect(rows.map(({ node }) => node.id)).toEqual(["build", "build.0"]);
  });

  it("draws one card, not one per item", () => {
    const graph = {
      nodes: [{ id: "build", type: "claude.worker" }],
      edges: [],
      channels: [],
    };
    const root = fanned([item(0, "ok"), item(1, "running")]);
    const drawn = graphInputOf(graph, [root, item(2, "ok")]);
    expect(drawn.nodes.map(({ id }) => id)).toEqual(["build"]);
  });
});

const event = (seq: number, node: string): StoredEvent => ({
  runId: "r",
  seq,
  at: "2026-11-03T00:00:00.000Z",
  event: {
    type: "node.started",
    id: node,
    nodeType: "claude.worker",
    round: 1,
  },
});

const EVENTS = [
  event(1, "build"),
  event(2, "build.0"),
  event(3, "build.2"),
  event(4, "build.10"),
  event(5, "builder"),
  event(6, "build.x"),
];

const kept = (node: string): number[] =>
  filterEvents(EVENTS, { ...NO_FILTERS, node }).map(({ seq }) => seq);

describe("the Logs node filter with items", () => {
  it("keeps a node with its items, and nothing that merely starts with it", () => {
    expect(kept("build")).toEqual([1, 2, 3, 4]);
  });

  it("keeps one item alone", () => {
    expect(kept("build.2")).toEqual([3]);
  });

  it("sorts items numerically and names the node's option", () => {
    const nodes = nodesIn(EVENTS, null);
    expect(nodes.slice(0, 4)).toEqual([
      "build",
      "build.0",
      "build.2",
      "build.10",
    ]);
    expect(nodeOption("build", nodes).label).toBe("build and its items");
    expect(nodeOption("build.2", nodes).label).toBe("build.2");
    expect(nodeOption("builder", nodes).label).toBe("builder");
  });
});
