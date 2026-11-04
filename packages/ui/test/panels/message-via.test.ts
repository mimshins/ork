/**
 * @file Tests that the Logs and Chats panels say how a message came when no
 *   session wrote it: a script's `ork send`, or a workflow's `notify:`.
 */

import type { StoredEvent } from "@krapht/ork-server/client";
import { describe, expect, it } from "vitest";

import { threadOf } from "../../src/panels/chats-model.ts";
import { lineOf } from "../../src/panels/logs-model.ts";

const stored = (seq: number, event: StoredEvent["event"]): StoredEvent => ({
  runId: "r1",
  seq,
  at: "2026-11-04T10:00:00.000Z",
  event,
});

const FROM_SCRIPT: StoredEvent["event"] = {
  type: "message.received",
  node: "lead",
  from: "check",
  message: 1,
  body: "tests failed",
  via: "script",
};

const FROM_RULE: StoredEvent["event"] = {
  type: "message.sent",
  node: "check",
  to: "lead",
  message: 2,
  body: "check exited 1",
  via: "rule",
};

const FROM_SESSION: StoredEvent["event"] = {
  type: "message.sent",
  node: "kid",
  to: "lead",
  message: 3,
  body: "done",
};

describe("a message's via", () => {
  it("shows in the Logs panel's line", () => {
    expect(lineOf(FROM_SCRIPT)).toBe("from check (script): tests failed");
    expect(lineOf(FROM_RULE)).toBe("to lead (rule): check exited 1");
    expect(lineOf(FROM_SESSION)).toBe("to lead: done");
  });

  it("shows as a note in the Chats panel's thread", () => {
    const thread = threadOf(
      [stored(1, FROM_SCRIPT), stored(2, FROM_RULE), stored(3, FROM_SESSION)],
      "lead",
    );
    expect(thread.map(item => [item.from, item.note])).toEqual([
      ["check", "a script"],
      ["check", "a rule"],
      ["kid", undefined],
    ]);
  });

  it("says a rule wrote in the sender's own thread", () => {
    const [item] = threadOf(
      [stored(1, { ...FROM_RULE, node: "lead", to: "kid" })],
      "lead",
    );
    expect(item?.text).toBe("A rule wrote to kid: check exited 1");
  });
});
