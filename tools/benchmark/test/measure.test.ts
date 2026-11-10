/** @file Tests a benchmark's working time, its commits and its totals. */

import { describe, expect, it } from "vitest";

import { resultCommits, summarize, usageCsv } from "../summary.ts";
import { type Activation, activations, workingMs } from "../timing.ts";
import type { Decision, StoredEvent } from "../tree.ts";

const MIN = 60_000;

const act = (
  node: string,
  start: number,
  end: number,
  more: Partial<Activation> = {},
): Activation => ({
  run: "r1",
  node,
  round: 1,
  type: "claude.worker",
  start: start * MIN,
  end: end * MIN,
  ...more,
});

const decision = (
  node: string,
  open: number,
  close: number | null,
): Decision => ({
  id: `r1-${node}`,
  run: "r1",
  node,
  kind: "question",
  openedAt: open * MIN,
  closedAt: close === null ? null : close * MIN,
});

const event = (
  type: string,
  at: number,
  data: Record<string, unknown>,
  run = "r1",
): StoredEvent => ({
  run,
  at: at * MIN,
  type,
  node: typeof data["id"] === "string" ? data["id"] : null,
  data,
});

describe("working time", () => {
  it("counts overlapping nodes once", () => {
    expect(workingMs([act("a", 0, 10), act("b", 5, 15)], [], 15 * MIN)).toBe(
      15 * MIN,
    );
  });

  it("leaves out gates and calls", () => {
    const acts = [
      act("build", 0, 10),
      act("approve", 10, 40, { type: "human.gate" }),
      act("plan", 40, 60, { type: "workflow.call" }),
    ];
    expect(workingMs(acts, [], 60 * MIN)).toBe(10 * MIN);
  });

  it("leaves out a node blocked on its own question", () => {
    expect(
      workingMs([act("a", 0, 30)], [decision("a", 10, 25)], 30 * MIN),
    ).toBe(15 * MIN);
  });

  it("leaves out a leader while its child waits on a question", () => {
    const acts = [act("lead", 0, 30), act("child", 5, 25, { owner: "lead" })];
    expect(workingMs(acts, [decision("child", 10, 20)], 30 * MIN)).toBe(
      20 * MIN,
    );
  });

  it("runs a question still open to the end", () => {
    expect(
      workingMs([act("a", 0, 30)], [decision("a", 10, null)], 30 * MIN),
    ).toBe(10 * MIN);
  });
});

describe("activations", () => {
  it("pairs each start with its finish, and ends an open one at the last event", () => {
    const events = [
      event("node.started", 0, {
        id: "a",
        nodeType: "claude.worker",
        round: 1,
        owner: "lead",
        agent: { name: "engine" },
      }),
      event("node.finished", 5, { id: "a", round: 1, ok: false }),
      event("node.started", 6, { id: "b", nodeType: "tool.shell", round: 1 }),
    ];
    expect(activations(events, 9 * MIN)).toEqual([
      {
        run: "r1",
        node: "a",
        round: 1,
        type: "claude.worker",
        owner: "lead",
        agent: "engine",
        start: 0,
        end: 5 * MIN,
        ok: false,
      },
      {
        run: "r1",
        node: "b",
        round: 1,
        type: "tool.shell",
        start: 6 * MIN,
        end: 9 * MIN,
      },
    ]);
  });
});

describe("result commits", () => {
  it("finds what git commit printed in a tool's output", () => {
    const events = [
      event("node.finished", 1, {
        id: "publish",
        output: {
          stdout: "[detached HEAD ed453d6] Let a node run\n 3 files changed",
        },
      }),
      event("node.finished", 2, {
        id: "docs",
        output: { stdout: "[main 1a2b3c4d] Sync docs" },
      }),
      event("node.finished", 3, {
        id: "check",
        output: { stdout: "see [the spec] for more" },
      }),
    ];
    expect(resultCommits(events)).toEqual(["ed453d6", "1a2b3c4d"]);
  });
});

const usage = (node: string, costUsd: number) => ({
  run: "r1",
  workflow: "build",
  node,
  model: "claude-sonnet-5-5",
  driver: "cli",
  kind: "node",
  round: 1,
  failed: false,
  costUsd,
  inputTokens: 1,
  outputTokens: 2,
  cacheReadTokens: 3,
  cacheWriteTokens: 4,
  turns: 5,
  durationMs: 6,
  at: "2026-11-10T00:00:00.000Z",
});

describe("summary", () => {
  const tree = {
    runs: [
      {
        id: "r1",
        workflow: "build",
        file: "/repo/.ork/workflows/build.ork.yaml",
        parent: null,
        status: "succeeded",
        startedAt: "1970-01-01T00:00:00.000Z",
        finishedAt: "1970-01-01T00:20:00.000Z",
        costUsd: 3,
      },
    ],
    events: [
      event("node.started", 0, {
        id: "build",
        nodeType: "claude.worker",
        round: 1,
      }),
      event("node.finished", 10, { id: "build", round: 1, ok: true }),
    ],
    decisions: [],
    usage: [usage("build", 1), usage("build", 2)],
  };

  it("adds cost, tokens and turns, and splits wall time into working and waiting", () => {
    expect(summarize(tree)).toMatchObject({
      cost_usd: 3,
      tokens: {
        input_tokens: 2,
        output_tokens: 4,
        cache_read_tokens: 6,
        cache_write_tokens: 8,
        all_tokens: 20,
      },
      turns: 10,
      sessions: 2,
      minutes: { working: 10, waiting_on_maintainer: 10, wall: 20 },
      by_node: { "build.build": { sessions: 2, cost_usd: 3 } },
    });
  });

  it("writes one CSV row per session", () => {
    expect(usageCsv(tree.usage).trim().split("\n")).toHaveLength(3);
  });
});
