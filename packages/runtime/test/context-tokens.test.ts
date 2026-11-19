/**
 * @file Each driver's decoder sets a session's context (`contextTokens`): the
 *   prompt of its last model request, input + cache read + cache write. Claude
 *   Code skips a sub-agent's requests; Codex, with no per-request usage, leaves
 *   it unset. Two legs of one session keep the later leg's.
 */

import type {
  RuntimeEvent,
  SessionOutcome,
  SessionSpec,
  SessionUsage,
} from "@krapht/ork-core";
import { describe, expect, it } from "vitest";

import type { LegDecoder } from "../src/adapter.ts";
import { claudeDecoder } from "../src/adapters/claude-code-events.ts";
import { codexDecoder } from "../src/adapters/codex-events.ts";
import { commandCodeDecoder } from "../src/adapters/command-code-events.ts";
import { openCodeDecoder, sumUsage } from "../src/adapters/open-code-events.ts";
import { addUsage } from "../src/adapters/session-usage.ts";

const spec: SessionSpec = {
  nodeId: "n",
  cwd: "/w",
  prompt: "Do it",
  systemAppend: "",
  settingSources: [],
  tools: { allow: [], deny: [] },
  permissionMode: "default",
  reportSchema: {},
};

/** The end a decoder gives for these lines, then an exit with `code`. */
const ended = (
  decoder: LegDecoder,
  lines: readonly object[],
  code = 0,
): SessionOutcome => {
  const events: RuntimeEvent[] = [
    ...lines.flatMap(line => decoder.decode(JSON.stringify(line)).events),
    ...decoder.exit(code),
  ];
  const last = events.at(-1);
  if (last?.type !== "session.finished") throw new Error("no end");
  return last.outcome;
};

/** A `claude` model response, from a sub-agent when `parent` is set. */
const response = (id: string, prompt: number, parent: string | null) => ({
  type: "assistant",
  parent_tool_use_id: parent,
  message: {
    id,
    content: [],
    usage: {
      input_tokens: prompt - 30,
      cache_read_input_tokens: 20,
      cache_creation_input_tokens: 10,
      output_tokens: 5,
    },
  },
});

const usage = (contextTokens?: number): SessionUsage => ({
  costUsd: 0,
  inputTokens: 1,
  outputTokens: 1,
  cacheReadTokens: 1,
  cacheWriteTokens: 1,
  turns: 1,
  durationMs: 0,
  ...(contextTokens === undefined ? {} : { contextTokens }),
});

/** An OpenCode step whose prompt is `input` + 55 cached. */
const step = (input: number) => ({
  type: "step_finish",
  sessionID: "s",
  part: { cost: 0, tokens: { input, cache: { read: 50, write: 5 } } },
});

/** A Command Code request whose prompt is `inputTokens` + 42 cached. */
const request = (inputTokens: number) => ({
  type: "event",
  event: {
    type: "model_request_end",
    usage: { inputTokens, cacheReadTokens: 40, cacheWriteTokens: 2 },
  },
});

describe("a session's context", () => {
  it("is claude-code's last main-thread response, sub-agents' skipped", () => {
    const outcome = ended(claudeDecoder(), [
      response("m1", 1000, null),
      response("m2", 4000, null),
      response("m3", 200, "task-1"),
      { type: "result", subtype: "success", session_id: "s" },
    ]);
    expect(outcome.usage.contextTokens).toBe(4000);
  });

  it("rides claude-code's usage so far, for a stopped leg", () => {
    const decoder = claudeDecoder();
    const said = decoder.decode(JSON.stringify(response("m1", 900, null)));
    expect(said.usage?.contextTokens).toBe(900);
  });

  it("is open-code's last step_finish", () => {
    const outcome = ended(openCodeDecoder(spec), [step(100), step(300)]);
    expect(outcome.usage.contextTokens).toBe(355);
  });

  it("is command-code's last model_request_end", () => {
    const outcome = ended(commandCodeDecoder(), [
      request(10),
      request(70),
      { type: "result", subtype: "success", usage: {} },
    ]);
    expect(outcome.usage.contextTokens).toBe(112);
  });

  it("is unset on codex, which reports usage once a turn", () => {
    const outcome = ended(codexDecoder(spec), [
      { type: "thread.started", thread_id: "th" },
      { type: "turn.completed", usage: { input_tokens: 500 } },
    ]);
    expect(outcome.usage).not.toHaveProperty("contextTokens");
  });
});

describe("two legs of one session", () => {
  it.each([
    ["addUsage", addUsage],
    ["sumUsage", sumUsage],
  ])("keep the later leg's context in %s", (_name, combine) => {
    expect(combine(usage(9000), usage(12_000)).contextTokens).toBe(12_000);
    expect(combine(usage(9000), usage()).contextTokens).toBe(9000);
    expect(combine(usage(), usage())).not.toHaveProperty("contextTokens");
  });
});
