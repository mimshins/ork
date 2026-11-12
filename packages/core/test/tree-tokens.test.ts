/**
 * @file Tests for what a run's tree keeps for tokens (RFC-015): a node's
 *   cache-write tokens, which a token budget counts, and whether its sessions
 *   ran on a driver that reports no dollars.
 */

import { describe, expect, it } from "vitest";

import { type RunEvent, runTree } from "../src/index.ts";

const events = (driver: "claude-code" | "command-code"): RunEvent[] => [
  {
    type: "run.started",
    runId: "r1",
    workflow: "w",
    entries: ["a"],
    nodes: [{ id: "a", type: "agent.worker" }],
  },
  { type: "node.started", id: "a", nodeType: "agent.worker", round: 1 },
  {
    type: "node.event",
    id: "a",
    event: {
      type: "session.started",
      sessionId: "s1",
      model: `${driver}.m`,
      driver,
    },
  },
  {
    type: "node.finished",
    id: "a",
    round: 1,
    ok: true,
    output: {},
    usage: {
      costUsd: 0,
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 900,
      cacheWriteTokens: 40,
      turns: 1,
      durationMs: 1,
    },
  },
];

describe("a node's tokens in the run's tree", () => {
  it("keeps its cache writes and marks a driver with no price", () => {
    expect(runTree(events("command-code"))[0]).toMatchObject({
      cacheWriteTokens: 40,
      unpriced: true,
    });
  });

  it("does not mark a priced driver", () => {
    expect(runTree(events("claude-code"))[0]?.unpriced).toBeUndefined();
  });
});
