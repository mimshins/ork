/**
 * @file The `claude-code` leg decoder keeps a report the session handed in
 *   through `StructuredOutput` and then wrote past: `claude`'s result can come
 *   without `structured_output`, and the session must not read as one that
 *   handed in nothing.
 */

import type { RuntimeEvent, SessionOutcome } from "@krapht/ork-core";
import { describe, expect, it } from "vitest";

import { claudeDecoder } from "../src/adapters/claude-code-events.ts";

const RAW = {
  status: "changes_requested",
  summary: "one finding",
  artifacts: {},
};

const call = (id: string, input: unknown): string =>
  JSON.stringify({
    type: "assistant",
    message: {
      content: [{ type: "tool_use", id, name: "StructuredOutput", input }],
    },
  });

const answer = (id: string, isError: boolean): string =>
  JSON.stringify({
    type: "user",
    message: {
      content: [{ type: "tool_result", tool_use_id: id, is_error: isError }],
    },
  });

const TEXT_AFTER = JSON.stringify({
  type: "assistant",
  message: { content: [{ type: "text", text: "Review is done." }] },
});

const result = (extra: Record<string, unknown> = {}): string =>
  JSON.stringify({
    type: "result",
    subtype: "success",
    session_id: "s1",
    result: "Review is done.",
    ...extra,
  });

/** The outcome a leg decoder gives for these lines, in order. */
const outcomeOf = (lines: readonly string[]): SessionOutcome => {
  const decoder = claudeDecoder();
  const events: RuntimeEvent[] = lines.flatMap(
    line => decoder.decode(line).events,
  );
  const last = events.at(-1);
  if (last?.type !== "session.finished") throw new Error("no end");
  return last.outcome;
};

describe("a report handed in, then written past", () => {
  it("is the session's report when the result has none", () => {
    const outcome = outcomeOf([
      call("t1", RAW),
      answer("t1", false),
      TEXT_AFTER,
      result(),
    ]);
    expect(outcome.report).toMatchObject({
      status: "changes_requested",
      summary: "one finding",
    });
    expect(outcome.end?.kind).not.toBe("no_report");
  });

  it("is the last one accepted when there were several", () => {
    const outcome = outcomeOf([
      call("t1", { ...RAW, summary: "first" }),
      answer("t1", false),
      call("t2", { ...RAW, summary: "second" }),
      answer("t2", false),
      result(),
    ]);
    expect(outcome.report?.summary).toBe("second");
  });

  it("is not a call claude refused", () => {
    const outcome = outcomeOf([
      call("t1", RAW),
      answer("t1", true),
      TEXT_AFTER,
      result(),
    ]);
    expect(outcome.report).toBeNull();
    expect(outcome.end?.kind).toBe("no_report");
  });

  it("gives way to the result's own report", () => {
    const outcome = outcomeOf([
      call("t1", { ...RAW, summary: "from the call" }),
      answer("t1", false),
      result({ structured_output: { ...RAW, summary: "from the result" } }),
    ]);
    expect(outcome.report?.summary).toBe("from the result");
  });
});
