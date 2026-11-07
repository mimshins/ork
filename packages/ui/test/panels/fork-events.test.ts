/**
 * @file Tests that a leader's fork, answering a child's question (ADR-063),
 *   shows as the fork's in the Logs and Chats panels, not as the leader
 *   talking: each log line says `fork:`, and the leader's thread has one line
 *   for it.
 */

import type { StoredEvent } from "@krapht/ork-server/client";
import { describe, expect, it } from "vitest";

import { threadOf } from "../../src/panels/chats-model.ts";
import { lineOf } from "../../src/panels/logs-model.ts";

const stored = (seq: number, event: StoredEvent["event"]): StoredEvent => ({
  runId: "r1",
  seq,
  at: "2026-11-08T10:00:00.000Z",
  event,
});

const EVENTS: StoredEvent[] = [
  stored(1, {
    type: "node.event",
    id: "lead",
    event: { type: "assistant.text", text: "Delegating the build." },
  }),
  stored(2, {
    type: "node.event",
    id: "lead",
    event: {
      type: "session.started",
      sessionId: "fork-1",
      model: "opus",
      fork: true,
    },
  }),
  stored(3, {
    type: "node.event",
    id: "lead",
    event: { type: "assistant.text", text: "b, as planned.", fork: true },
  }),
  stored(4, {
    type: "node.event",
    id: "lead",
    event: {
      type: "tool.called",
      id: "t1",
      name: "Read",
      input: { file_path: "spec.md" },
      fork: true,
    },
  }),
];

describe("a leader's fork", () => {
  it("says it is a fork in each Logs line", () => {
    expect(EVENTS.map(({ event }) => lineOf(event))).toEqual([
      "Delegating the build.",
      "fork: session on opus",
      "fork: b, as planned.",
      'fork: Read {"file_path":"spec.md"}',
    ]);
  });

  it("is one line in the leader's thread, not its words", () => {
    expect(
      threadOf(EVENTS, "lead").map(item => [item.kind, item.text]),
    ).toEqual([
      ["node", "Delegating the build."],
      ["activity", "A fork took a child's question"],
    ]);
  });
});
