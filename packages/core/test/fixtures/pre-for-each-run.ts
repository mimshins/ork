/**
 * @file A run as recorded before `forEach` (RFC-013): no `each.*` events, no
 *   `item` field. It stays here so resuming such a run keeps working. A worker
 *   passed, a spawned instance reported to its leader, and a tool failed.
 */

import type { RunEvent } from "../../src/index.ts";

export const PRE_FOR_EACH_RUN: RunEvent[] = [
  {
    type: "run.started",
    runId: "old",
    workflow: "t",
    entries: ["write"],
    nodes: [
      { id: "write", type: "claude.worker" },
      { id: "publish", type: "tool.shell" },
    ],
    inputs: {},
    settings: { inPlace: true },
  },
  { type: "node.started", id: "write", nodeType: "claude.worker", round: 1 },
  {
    type: "node.event",
    id: "write",
    event: { type: "session.started", sessionId: "s-write", model: "m" },
  },
  {
    type: "node.finished",
    id: "write",
    round: 1,
    ok: true,
    output: { status: "pass", summary: "wrote it" },
  },
  { type: "edge.taken", from: "write", to: "publish" },
  { type: "node.started", id: "publish", nodeType: "tool.shell", round: 1 },
  {
    type: "node.finished",
    id: "publish",
    round: 1,
    ok: false,
    output: { exitCode: 1, stdout: "", stderr: "no" },
    error: "publish exited 1",
  },
  {
    type: "run.finished",
    result: {
      runId: "old",
      status: "failed",
      costUsd: 0,
      nodes: [],
      reasons: ["publish: publish exited 1"],
      worktrees: [],
    },
  },
];
