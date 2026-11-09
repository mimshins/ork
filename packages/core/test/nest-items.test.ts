/**
 * @file Tests for how a run's tree shows a node with `forEach` (RFC-013), on
 *   recorded runs: the items nested under their node, wherever the events put
 *   them, the node's `listed` count from its latest list, and a run from before
 *   `each.listed` left as it was.
 */

import { describe, expect, it } from "vitest";

import {
  activeTree,
  flattenTree,
  isItem,
  nestItems,
  type RunEvent,
  runTree,
  type StoredEvent,
} from "../src/index.ts";

const usage = (costUsd: number) => ({
  costUsd,
  inputTokens: 100,
  outputTokens: 20,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  turns: 1,
  durationMs: 1000,
});

const item = (index: number, costUsd: number, owner?: string): RunEvent[] => [
  {
    type: "node.started",
    id: `build.${String(index)}`,
    nodeType: "claude.worker",
    round: 1,
    item: { of: "build", index },
    ...(owner === undefined ? {} : { owner }),
  },
  {
    type: "node.finished",
    id: `build.${String(index)}`,
    round: 1,
    ok: true,
    output: { status: "pass" },
    usage: usage(costUsd),
  },
];

const listed = (round: number, list: string[]): RunEvent => ({
  type: "each.listed",
  node: "build",
  round,
  count: list.length,
  list,
});

const started = (nodes: { id: string; parent?: string }[]): RunEvent => ({
  type: "run.started",
  runId: "r1",
  workflow: "w",
  entries: ["build"],
  nodes: nodes.map(node => ({ ...node, type: "claude.worker" })),
});

const FANNED: RunEvent[] = [
  started([{ id: "plan" }, { id: "build" }]),
  { type: "node.started", id: "build", nodeType: "claude.worker", round: 1 },
  listed(1, ["a", "b", "c"]),
  ...item(0, 1),
  ...item(1, 2),
  ...item(2, 3),
  { type: "node.finished", id: "build", round: 1, ok: true, output: {} },
];

/** Each event stored two seconds after the one before it. */
const STORED: StoredEvent[] = FANNED.map((event, at) => ({
  runId: "r1",
  seq: at + 1,
  at: new Date(Date.UTC(2026, 10, 8, 12, 0, at * 2)).toISOString(),
  event,
}));

/** A leader's spawned worker, recorded with no `each.listed` anywhere. */
const SPAWNED: RunEvent[] = [
  started([{ id: "lead" }, { id: "fix" }]),
  { type: "node.started", id: "lead", nodeType: "claude.leader", round: 1 },
  {
    type: "node.started",
    id: "fix-1",
    nodeType: "claude.worker",
    round: 1,
    owner: "lead",
  },
  { type: "node.finished", id: "fix-1", round: 1, ok: true, output: {} },
];

describe("a fanned node in a run's tree", () => {
  it("has its items under it, in list order, and its list's count", () => {
    const roots = nestItems(activeTree(STORED));
    expect(roots.map(root => root.id)).toEqual(["plan", "build"]);
    expect(roots[1]?.listed).toBe(3);
    expect(
      roots[1]?.children.map(child => [
        child.id,
        child.template,
        child.costUsd,
      ]),
    ).toEqual([
      ["build.0", "build", 1],
      ["build.1", "build", 2],
      ["build.2", "build", 3],
    ]);
    expect(roots[1]?.children[0]?.startedAt).toBe("2026-11-08T12:00:06.000Z");
    expect(JSON.stringify(roots[1])).toContain('"id":"build.2"');
  });

  it("takes an item from under its owner too", () => {
    const roots = nestItems(
      runTree([
        started([{ id: "lead" }, { id: "build", parent: "lead" }]),
        ...item(0, 1, "lead"),
      ]),
    );
    expect(roots.map(root => root.id)).toEqual(["lead"]);
    expect(roots[0]?.children.map(child => child.id)).toEqual(["build"]);
    expect(roots[0]?.children[0]?.children.map(child => child.id)).toEqual([
      "build.0",
    ]);
  });

  it("counts its latest list", () => {
    const [, build] = runTree([...FANNED, listed(2, ["a"])]);
    expect(build?.listed).toBe(1);
  });

  it("shows its items waiting when a higher round lists again", () => {
    const [, build] = nestItems(
      runTree([...FANNED, listed(2, ["a", "b", "c"])]),
    );
    expect(build?.listed).toBe(3);
    expect(build?.children.map(child => child.state)).toEqual([
      "waiting",
      "waiting",
      "waiting",
    ]);
  });

  it("keeps its items' states when a resume lists the same round again", () => {
    const [, build] = nestItems(
      runTree([...FANNED, listed(1, ["a", "b", "c"])]),
    );
    expect(build?.children.map(child => child.state)).toEqual([
      "ok",
      "ok",
      "ok",
    ]);
  });

  it("shows an item running again once its new round starts", () => {
    const [, build] = nestItems(
      runTree([...FANNED, listed(2, ["a", "b"]), ...item(1, 1).slice(0, 1)]),
    );
    expect(build?.children.map(child => child.state)).toEqual([
      "waiting",
      "running",
      "waiting",
    ]);
  });

  it("leaves an item with no node of its own where it is", () => {
    const roots = nestItems(runTree([started([]), ...item(0, 1)]));
    expect(roots.map(root => root.id)).toEqual(["build.0"]);
  });
});

describe("isItem", () => {
  it("is true of an item, and not of a spawned worker or a declared node", () => {
    const flat = flattenTree([...runTree(SPAWNED), ...runTree(FANNED)]);
    expect(flat.filter(node => isItem(node)).map(node => node.id)).toEqual([
      "build.0",
      "build.1",
      "build.2",
    ]);
  });
});

describe("a run from before each.listed", () => {
  it("keeps its tree, with no count", () => {
    const roots = nestItems(runTree(SPAWNED));
    expect(roots).toEqual(runTree(SPAWNED));
    expect(roots[0]?.children.map(child => child.id)).toEqual(["fix-1"]);
    expect(JSON.stringify(roots)).not.toContain("listed");
  });
});
