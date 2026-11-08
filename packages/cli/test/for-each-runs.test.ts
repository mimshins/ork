/**
 * @file Tests for a fanned node's items in what `ork logs`, `ork tree` and the
 *   `ork run` transcript print (RFC-013), on a recorded run: the node's and its
 *   items' events, `each.listed` and `each.exceeded` in words, and the items
 *   nested under their node with state, time and cost.
 */

import {
  activeTree,
  isNodeEvent,
  type RunEvent,
  type StoredEvent,
} from "@krapht/ork-core";
import { describe, expect, it } from "vitest";

import {
  createLogPrinter,
  formatRunEvent,
  formatTree,
  nestItems,
} from "../src/index.ts";

/** Colors off: lines compare as plain text. */
const plain = (line: string): string =>
  // oxlint-disable-next-line no-control-regex -- strips the terminal's escape codes
  line.replaceAll(/\u001B\[[0-9;]*m/gu, "");

const usage = (costUsd: number) => ({
  costUsd,
  inputTokens: 100,
  outputTokens: 20,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  turns: 1,
  durationMs: 1000,
});

const item = (index: number, seconds: number): RunEvent[] => [
  {
    type: "node.started",
    id: `build.${String(index)}`,
    nodeType: "claude.worker",
    round: 1,
    item: { of: "build", index },
  },
  {
    type: "node.finished",
    id: `build.${String(index)}`,
    round: 1,
    ok: true,
    output: { status: "pass", summary: `did ${String(seconds)}` },
    usage: usage(0.5 * seconds),
  },
];

const LISTED: RunEvent = {
  type: "each.listed",
  node: "build",
  round: 1,
  count: 3,
  list: ["a", "b", "c"],
};

const RUN: RunEvent[] = [
  {
    type: "run.started",
    runId: "r1",
    workflow: "w",
    entries: ["plan"],
    nodes: [
      { id: "plan", type: "tool.shell" },
      { id: "build", type: "claude.worker" },
    ],
  },
  { type: "node.started", id: "plan", nodeType: "tool.shell", round: 1 },
  { type: "node.started", id: "build", nodeType: "claude.worker", round: 1 },
  LISTED,
  ...item(0, 2),
  ...item(1, 4),
  ...item(2, 6),
  {
    type: "node.finished",
    id: "build",
    round: 1,
    ok: true,
    output: { count: 3 },
  },
];

/** Each event stored two seconds after the one before it. */
const STORED: StoredEvent[] = RUN.map((event, at) => ({
  runId: "r1",
  seq: at + 1,
  at: new Date(Date.UTC(2026, 10, 8, 12, 0, at * 2)).toISOString(),
  event,
}));

const logged = (node: string | undefined, json = false): string[] => {
  const print = createLogPrinter({
    json,
    ...(node === undefined ? {} : { node }),
  });
  return STORED.flatMap(stored => print(stored)).map(line => plain(line));
};

describe("ork logs --node", () => {
  it("keeps a fanned node and its items, and nothing of the others", () => {
    const lines = logged("build");
    expect(lines.join("\n")).toContain("build.0");
    expect(lines.join("\n")).toContain("build.2");
    expect(lines.join("\n")).toContain("3 items");
    expect(lines.join("\n")).not.toContain("plan");
  });

  it("keeps one item with its id", () => {
    const lines = logged("build.2");
    expect(lines.join("\n")).toContain("did 6");
    expect(lines.join("\n")).not.toContain("build.1");
    expect(lines.join("\n")).not.toContain("3 items");
  });

  it("carries the items' events as JSON lines", () => {
    expect(logged("build", true)).toEqual(
      STORED.filter(({ event }) => isNodeEvent(event, "build")).map(stored =>
        JSON.stringify(stored),
      ),
    );
    expect(logged("build", true)).toHaveLength(9);
  });
});

/** The transcript lines for one event, plain. */
const line = (event: RunEvent) =>
  formatRunEvent(event, 8, new Map()).map(text => plain(text));

describe("the transcript", () => {
  it("says how many items a list has, one line each", () => {
    expect(line(LISTED)).toEqual(["build    │ 3 items"]);
    expect(
      line({
        type: "each.listed",
        node: "build",
        round: 2,
        count: 1,
        list: ["a"],
      }),
    ).toEqual(["build    │ 1 item (round 2)"]);
  });

  it("says when a list is over maxItems", () => {
    expect(
      line({
        type: "each.exceeded",
        node: "build",
        round: 1,
        count: 12,
        maxItems: 10,
      }),
    ).toEqual(["build    │ ! 12 items, over maxItems 10"]);
  });
});

describe("ork tree", () => {
  const now = Date.parse("2026-11-08T12:01:00Z");

  it("lists items under their node with state, time and cost", () => {
    const roots = nestItems(activeTree(STORED));
    expect(roots.map(root => root.id)).toEqual(["plan", "build"]);
    expect(roots[1]?.children.map(child => child.id)).toEqual([
      "build.0",
      "build.1",
      "build.2",
    ]);
    const lines = formatTree(roots, now).map(text => plain(text));
    expect(lines).toEqual([
      "plan        tool.shell     ● running",
      "build       claude.worker  ✓ 3 ran",
      "├─ build.0  claude.worker  ✓ pass: did 2  2s  100 in / 20 out · $1.0000",
      "├─ build.1  claude.worker  ✓ pass: did 4  2s  100 in / 20 out · $2.0000",
      "└─ build.2  claude.worker  ✓ pass: did 6  2s  100 in / 20 out · $3.0000",
    ]);
  });

  it("carries the items in --json", () => {
    const [, build] = nestItems(activeTree(STORED));
    expect(
      build?.children.map(child => [child.id, child.template, child.costUsd]),
    ).toEqual([
      ["build.0", "build", 1],
      ["build.1", "build", 2],
      ["build.2", "build", 3],
    ]);
    expect(build?.children[0]?.startedAt).toBe("2026-11-08T12:00:08.000Z");
    expect(JSON.stringify(build)).toContain('"id":"build.2"');
  });
});
