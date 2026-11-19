/**
 * @file The `omp` driver's decoder and spend ledger (RFC-026), on hand-written
 *   lines in the shapes of the RFC's capture legs: the session and its fork,
 *   assistant text, tool calls paired by id, the fields Ork drops, usage and
 *   cost per request, and the ends by exit code.
 */

import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { RuntimeEvent, SessionOutcome } from "@krapht/ork-core";
import { afterEach, describe, expect, it } from "vitest";

import type { LegDecoder } from "../src/adapter.ts";
import {
  ompDecoder,
  ompRequestUsage,
  ompUsage,
} from "../src/adapters/omp-events.ts";
import { addSpend, sessionSpend } from "../src/adapters/omp-ledger.ts";
import { BAD_ARGUMENTS } from "../src/tools/tool.ts";

const spec = { cwd: "/w", model: "anthropic/claude-haiku-5-5" };

const session = (id: string, parentSession?: string) => ({
  type: "session",
  version: 3,
  id,
  timestamp: "2026-11-19T00:00:00.000Z",
  cwd: "/w",
  ...(parentSession === undefined
    ? {}
    : { parentSession, providerPromptCacheKey: "k" }),
});

type Tokens = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
};

const TOKENS: Tokens = {
  input: 100,
  output: 20,
  cacheRead: 300,
  cacheWrite: 50,
  total: 0.002,
};

/** An assistant message in the capture legs' shape, with omp's own fields. */
const assistant = (
  content: object[],
  tokens: Tokens = TOKENS,
  stopReason = "stop",
) => ({
  role: "assistant",
  content,
  api: "anthropic-messages",
  provider: "anthropic",
  model: "claude-haiku-5-5",
  usage: {
    input: tokens.input,
    output: tokens.output,
    cacheRead: tokens.cacheRead,
    cacheWrite: tokens.cacheWrite,
    totalTokens:
      tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: tokens.total,
    },
  },
  stopReason,
  timestamp: 1,
  requestControls: {
    messageIndex: 1,
    tools: { declared: ["bash"], deferred: [], active: ["bash"] },
    effort: { topLevel: "medium", tail: "medium" },
  },
  responseId: "resp_secret",
  credentialId: 7,
  duration: 1,
  ttft: 1,
  completedAt: 2,
});

const said = (words: string) => ({ type: "text", text: words });
const thinking = {
  type: "thinking",
  thinking: "private musing",
  thinkingSignature: "sig_secret",
};
const toolCall = (id: string) => ({
  type: "toolCall",
  id,
  name: "bash",
  arguments: { command: "ls", i: "list" },
  intent: "list",
});

const messageEnd = (message: object) => ({ type: "message_end", message });

const start = (toolCallId: string, toolName: string, args: object) => ({
  type: "tool_execution_start",
  toolCallId,
  toolName,
  args,
  intent: "intent_secret",
});

const finish = (
  toolCallId: string,
  toolName: string,
  isError: boolean,
  text = "ok",
) => ({
  type: "tool_execution_end",
  toolCallId,
  toolName,
  result: {
    content: [{ type: "text", text }],
    details: { trace: "details_secret" },
  },
  isError,
});

const notice = {
  type: "notice",
  level: "error",
  message: "Session cost limit reached: $0.0021 of $0.0010",
  source: "cost-gate",
};

/** Every event the decoder gives for these lines. */
const decodeAll = (decoder: LegDecoder, lines: readonly object[]) =>
  lines.flatMap(line => decoder.decode(JSON.stringify(line)).events);

/** The outcome after these lines and an exit with `code`. */
const outcomeOf = (
  decoder: LegDecoder,
  lines: readonly object[],
  code: number,
): SessionOutcome => {
  decodeAll(decoder, lines);
  const last = decoder.exit(code).at(-1);
  if (last?.type !== "session.finished") throw new Error("no end");
  return last.outcome;
};

/**
 * What a leg on `leg` records, from 0.05 spent before, for a header naming a
 * parent session and one request.
 */
const recordedBy = (leg: Parameters<typeof ompDecoder>[0]) => {
  const recorded: [string, number][] = [];
  decodeAll(
    ompDecoder(leg, {
      spentBefore: 0.05,
      record: (id, usd) => {
        recorded.push([id, usd]);
      },
    }),
    [session("s2", "/x/s1.jsonl"), messageEnd(assistant([]))],
  );
  return recorded;
};

const ofType = (events: readonly RuntimeEvent[], type: string) =>
  events.filter(event => event.type === type);

/** A turn with a shell call: the whole of a leg's lines, repeats included. */
const turn = [
  session("s1"),
  { type: "advisor_cost_changed" },
  { type: "agent_start" },
  { type: "turn_start" },
  { type: "message_start", message: { role: "user", content: [said("go")] } },
  messageEnd({
    role: "user",
    content: [said("go")],
    attribution: "user",
    timestamp: 1,
  }),
  { type: "message_start", message: assistant([]) },
  {
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "x" },
  },
  messageEnd(assistant([thinking, said("Listing."), toolCall("c1")])),
  start("c1", "bash", { command: "ls" }),
  {
    type: "tool_execution_update",
    toolCallId: "c1",
    toolName: "bash",
    args: { command: "ls" },
    partialResult: { content: [said("a")], details: {} },
  },
  finish("c1", "bash", false),
  messageEnd({
    role: "toolResult",
    toolCallId: "c1",
    toolName: "bash",
    content: [said("a")],
    details: {},
    isError: false,
    timestamp: 1,
  }),
  { type: "turn_end", message: assistant([said("Listing.")]), toolResults: [] },
  messageEnd(assistant([said("Done.")])),
  {
    type: "agent_end",
    messages: [assistant([said("Done.")])],
    isTerminal: true,
    yielded: false,
  },
];

describe("ompDecoder's lines", () => {
  it("starts the session at its header", () => {
    const events = decodeAll(ompDecoder(spec), [session("s1")]);
    expect(events).toEqual([
      {
        type: "session.started",
        sessionId: "s1",
        model: "anthropic/claude-haiku-5-5",
        cwd: "/w",
      },
    ]);
  });

  it("names omp's default model when the node names none", () => {
    const events = decodeAll(ompDecoder({ cwd: "/w" }), [session("s1")]);
    expect(events[0]).toMatchObject({ model: "default" });
  });

  it("starts a fork under its new id", () => {
    const events = decodeAll(ompDecoder(spec), [session("s2", "/x/s1.jsonl")]);
    expect(events[0]).toMatchObject({ sessionId: "s2" });
  });

  it("gives an assistant message's text blocks only", () => {
    const events = decodeAll(ompDecoder(spec), [
      session("s1"),
      messageEnd(assistant([thinking, said("Hi."), toolCall("c1")])),
    ]);
    expect(ofType(events, "assistant.text")).toEqual([
      { type: "assistant.text", text: "Hi." },
    ]);
  });

  it("gives nothing for a user or a tool result message", () => {
    const events = decodeAll(ompDecoder(spec), [
      messageEnd({ role: "user", content: [said("go")] }),
      messageEnd({
        role: "toolResult",
        toolCallId: "c1",
        content: [said("x")],
        isError: false,
      }),
    ]);
    expect(events).toEqual([]);
  });

  it("names tools in Ork's words and pairs interleaved calls by id", () => {
    const events = decodeAll(ompDecoder(spec), [
      start("c1", "bash", { command: "ls" }),
      start("c2", "mcp__ork_session_ork_ask_user", { question: "?" }),
      finish("c2", "mcp__ork_session_ork_ask_user", false),
      finish("c1", "bash", true),
    ]);
    expect(events).toEqual([
      { type: "tool.called", id: "c1", name: "Bash", input: { command: "ls" } },
      {
        type: "tool.called",
        id: "c2",
        name: "mcp__ork__ask_user",
        input: { question: "?" },
      },
      { type: "tool.result", id: "c2", isError: false },
      { type: "tool.result", id: "c1", isError: true },
    ]);
  });

  it("keeps a name it does not know as omp wrote it", () => {
    const events = decodeAll(ompDecoder(spec), [start("c1", "eval", {})]);
    expect(events[0]).toMatchObject({ name: "eval" });
  });

  it("gives a refused call as an error result", () => {
    const events = decodeAll(ompDecoder(spec), [
      start("c1", "bash", { command: "rm -rf x" }),
      finish("c1", "bash", true, "Ork refused Bash(rm -rf x)"),
    ]);
    expect(events.at(-1)).toEqual({
      type: "tool.result",
      id: "c1",
      isError: true,
    });
  });

  it("marks an Ork tool's bad-arguments answer as the agent's fault", () => {
    const events = decodeAll(ompDecoder(spec), [
      start("c1", "mcp__ork_session_ork_report", {}),
      finish(
        "c1",
        "mcp__ork_session_ork_report",
        false,
        `${BAD_ARGUMENTS} status`,
      ),
    ]);
    expect(events.at(-1)).toEqual({
      type: "tool.result",
      id: "c1",
      isError: true,
      fault: "arguments",
    });
  });

  it("emits each message and call once, though turn_end and agent_end repeat them", () => {
    const events = decodeAll(ompDecoder(spec), turn);
    expect(events.map(event => event.type)).toEqual([
      "session.started",
      "assistant.text",
      "tool.called",
      "tool.result",
      "assistant.text",
    ]);
  });

  it("keeps omp's and the provider's own fields out of every event", () => {
    const decoder = ompDecoder(spec);
    const shown = JSON.stringify([
      ...decodeAll(decoder, turn),
      ...decoder.exit(0),
    ]);
    expect(shown).not.toMatch(
      /credentialId|responseId|thinkingSignature|_secret|details|intent|requestControls|private musing/u,
    );
  });
});

describe("ompDecoder's ends", () => {
  it("answers with the last assistant message's text, no_report at exit 0", () => {
    const outcome = outcomeOf(ompDecoder(spec), turn, 0);
    expect(outcome).toMatchObject({
      subtype: "success",
      sessionId: "s1",
      text: "Done.",
      report: null,
      errors: [],
    });
    expect(outcome.end?.kind).toBe("no_report");
  });

  it("ends budget_limit at exit 3 after the notice and agent_end", () => {
    const outcome = outcomeOf(
      ompDecoder(spec),
      [
        session("s1"),
        messageEnd(assistant([toolCall("c1")], TOKENS, "toolUse")),
        notice,
        { type: "agent_end", messages: [], isTerminal: true, yielded: false },
      ],
      3,
    );
    expect(outcome.end).toMatchObject({
      kind: "budget_limit",
      detail: notice.message,
    });
    expect(outcome.subtype).toBe("error_max_budget_usd");
  });

  it("ends budget_limit at exit 3 on a resumed leg already over the cap", () => {
    const outcome = outcomeOf(
      ompDecoder(spec, { spentBefore: 0.5 }),
      [session("s1"), { type: "advisor_cost_changed" }, notice],
      3,
    );
    expect(outcome.end).toMatchObject({
      kind: "budget_limit",
      detail: notice.message,
    });
    expect(outcome.usage.costUsd).toBe(0.5);
  });

  it("gives nothing at exit 1 with no line to explain it", () => {
    const decoder = ompDecoder(spec);
    decodeAll(decoder, []);
    expect(decoder.exit(1)).toEqual([]);
  });

  it("explains a failed leg by a request's odd stopReason", () => {
    const outcome = outcomeOf(
      ompDecoder(spec),
      [
        session("s1"),
        messageEnd({
          ...assistant([], TOKENS, "error"),
          errorMessage: "upstream exploded",
        }),
      ],
      1,
    );
    expect(outcome.end).toMatchObject({ kind: "driver_crashed" });
    expect(outcome.end?.detail).toContain("stopReason: error");
    expect(outcome.end?.detail).toContain("upstream exploded");
  });

  it("ends interrupted at exit 130, the aborted message not counted", () => {
    const outcome = outcomeOf(
      ompDecoder(spec),
      [
        session("s1"),
        messageEnd(assistant([said("Hi.")])),
        messageEnd(
          assistant(
            [],
            { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            "aborted",
          ),
        ),
        { type: "turn_end" },
      ],
      130,
    );
    expect(outcome.end?.kind).toBe("interrupted");
    expect(outcome.usage).toMatchObject({ turns: 1, contextTokens: 450 });
  });
});

describe("ompDecoder's usage", () => {
  it("adds each request's tokens, dollars and one turn, line by line", () => {
    const decoder = ompDecoder(spec);
    decoder.decode(JSON.stringify(session("s1")));
    const first = decoder.decode(JSON.stringify(messageEnd(assistant([]))));
    const second = decoder.decode(
      JSON.stringify(
        messageEnd(
          assistant([], {
            input: 10,
            output: 5,
            cacheRead: 700,
            cacheWrite: 0,
            total: 0.001,
          }),
        ),
      ),
    );
    expect(first.usage).toMatchObject({ inputTokens: 100, turns: 1 });
    expect(second.usage).toMatchObject({
      inputTokens: 110,
      outputTokens: 25,
      cacheReadTokens: 1000,
      cacheWriteTokens: 50,
      turns: 2,
      contextTokens: 710,
    });
    expect(second.usage?.costUsd).toBeCloseTo(0.003);
  });

  it("reads one request's usage, cache reads apart from input", () => {
    expect(
      ompRequestUsage({
        input: 101,
        output: 2,
        cacheRead: 30,
        cacheWrite: 4,
        cost: { total: 0.01 },
      }),
    ).toEqual({
      costUsd: 0.01,
      inputTokens: 101,
      outputTokens: 2,
      cacheReadTokens: 30,
      cacheWriteTokens: 4,
      turns: 1,
      durationMs: 0,
      contextTokens: 135,
    });
  });

  it("starts a resumed leg's cost from what the session had spent", () => {
    const outcome = outcomeOf(
      ompDecoder(spec, { spentBefore: 0.01 }),
      [session("s1"), messageEnd(assistant([said("Hi.")]))],
      0,
    );
    expect(outcome.usage.costUsd).toBeCloseTo(0.012);
  });

  it("records each request's dollars under the session's id", () => {
    const recorded: [string, number][] = [];
    decodeAll(
      ompDecoder(spec, {
        record: (id, usd) => {
          recorded.push([id, usd]);
        },
      }),
      turn,
    );
    expect(recorded).toEqual([
      ["s1", 0.002],
      ["s1", 0.002],
    ]);
  });

  it("records a fork's inherited spend under its new id", () => {
    expect(recordedBy({ ...spec, fork: true })).toEqual([
      ["s2", 0.05],
      ["s2", 0.002],
    ]);
  });

  it("does not record the inherited spend again when a fork is resumed", () => {
    // The resumed fork's header still names its parent; its entry already
    // holds the inherited spend, so only the new request is added.
    expect(recordedBy({ ...spec, fork: false })).toEqual([["s2", 0.002]]);
  });

  it("combines two legs as one session: tokens summed, the later total cost", () => {
    const first = outcomeOf(ompDecoder(spec), turn, 0).usage;
    const second = outcomeOf(
      ompDecoder(spec, { spentBefore: first.costUsd }),
      [session("s1"), messageEnd(assistant([said("Again.")]))],
      0,
    ).usage;
    const both = ompUsage.combine(first, second);
    expect(ompUsage.dollars).toBe(true);
    expect(both).toMatchObject({ inputTokens: 300, turns: 3 });
    expect(both.costUsd).toBeCloseTo(0.006);
  });
});

describe("the omp spend ledger", () => {
  let dir = "";
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const fresh = (): string => {
    dir = mkdtempSync(path.join(tmpdir(), "ork-omp-ledger-"));
    return path.join(dir, "spent");
  };

  it("reads a session it has no entry for as 0", () => {
    expect(sessionSpend(fresh(), "s1")).toBe(0);
  });

  it("adds each spend to the session's entry", () => {
    const spent = fresh();
    addSpend(spent, "s1", 0.25);
    addSpend(spent, "s1", 0.5);
    addSpend(spent, "s2", 1);
    expect(sessionSpend(spent, "s1")).toBe(0.75);
    expect(sessionSpend(spent, "s2")).toBe(1);
  });

  it("keeps its entries 0600 in a 0700 folder", () => {
    const spent = fresh();
    addSpend(spent, "s1", 0.1);
    expect(statSync(spent).mode & 0o777).toBe(0o700);
    expect(statSync(path.join(spent, "s1")).mode & 0o777).toBe(0o600);
  });

  it("writes nothing for an id that is not a plain file name", () => {
    const spent = fresh();
    addSpend(spent, "../escape", 1);
    expect(sessionSpend(spent, "../escape")).toBe(0);
    expect(() => statSync(path.join(dir, "escape"))).toThrow("ENOENT");
  });
});
