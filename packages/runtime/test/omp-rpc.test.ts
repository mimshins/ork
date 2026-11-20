/**
 * @file The `omp --mode rpc` codec (RFC-027), on frames in the shapes of the
 *   RFC's spike: the handshake and first requests, a steer and an abort with
 *   their responses, an approval allowed and denied, approvals paired with
 *   their calls first in, first out, a `select` it cannot read, a `setWidget`
 *   ignored, a turn that settles later, the ends at `session_settled`, a
 *   chunked frame, and a resumed leg's message.
 */

import type {
  RuntimeEvent,
  SessionOutcome,
  SessionSpec,
} from "@krapht/ork-core";
import { describe, expect, it } from "vitest";

import type {
  Codec,
  DecodedFrame,
  Frame,
  FrameRequest,
} from "../src/adapter.ts";
import {
  OMP_PAUSE_MESSAGE,
  OMP_SLOT_MESSAGE,
  ompRpcCodec,
} from "../src/adapters/omp-rpc.ts";

const specOf = (over: Partial<SessionSpec> = {}): SessionSpec => ({
  nodeId: "omp",
  cwd: "/w",
  prompt: "Do the task",
  systemAppend: "# Ork",
  settingSources: ["project", "local"],
  tools: { allow: [], deny: [] },
  permissionMode: "default",
  reportSchema: { type: "object" },
  reading: "open",
  ...over,
});

const leg = { endpoint: { url: "", token: "" }, allowed: [] };

const READY = {
  type: "ready",
  protocolVersion: 1,
  supportedProtocolVersions: [1, 2],
  maxFrameBytes: 1_048_576,
};

/** The response `omp` gives a request; `data` for `get_state`'s. */
const response = (id: string, command: string, data?: object) => ({
  type: "response",
  id,
  command,
  success: true,
  ...(data === undefined ? {} : { data }),
});

const start = (toolCallId: string, toolName: string, args: object) => ({
  type: "tool_execution_start",
  toolCallId,
  toolName,
  args,
  intent: "intent",
});

const select = (id: string, options: string[]) => ({
  type: "extension_ui_request",
  id,
  method: "select",
  title: "Allow tool: write\nPath: a.txt\nContent:\nx",
  options,
});

const SPIKE_OPTIONS = ["Approve", "Approve write for this session", "Deny"];

const assistantEnd = (text: string) => ({
  type: "message_end",
  message: {
    role: "assistant",
    content: [{ type: "text", text }],
    usage: {
      input: 10,
      output: 5,
      cacheRead: 0,
      cacheWrite: 0,
      cost: { total: 0.001 },
    },
    stopReason: "stop",
  },
});

const promptResult = (
  status: string,
  sessionSettled: boolean,
  error?: object,
) => ({
  type: "prompt_result",
  status,
  sessionSettled,
  ...(error === undefined ? {} : { error }),
});

const SETTLED = { type: "session_settled" };

/** A codec past the handshake, its session started as `get_state` says. */
const opened = (
  spec: SessionSpec = specOf(),
): ReturnType<typeof ompRpcCodec> => {
  const codec = ompRpcCodec(spec);
  codec.decode(READY);
  const [state] = codec.open(spec, leg);
  codec.decode(response(state?.id ?? "", "get_state", { sessionId: "s1" }));
  return codec;
};

/** The id of the request at `at`, or "" when there is none. */
const idAt = (requests: FrameRequest[], at: number): string =>
  requests[at]?.id ?? "";

const decodeAll = (codec: Codec, frames: Frame[]): DecodedFrame[] =>
  frames.map(frame => codec.decode(frame));

const eventsOf = (decoded: DecodedFrame[]): RuntimeEvent[] =>
  decoded.flatMap(each => each.events);

const finished = (events: RuntimeEvent[]): SessionOutcome[] =>
  events.flatMap(event =>
    event.type === "session.finished" ? [event.outcome] : [],
  );

describe("the omp rpc codec", () => {
  it("is ready at `ready`, then asks for the state and sends the prompt", () => {
    const codec = ompRpcCodec(specOf());
    expect(codec.decode(READY)).toEqual({ events: [], ready: true });
    const requests = codec.open(specOf(), leg);
    expect(requests.map(each => each.frame)).toEqual([
      { id: requests[0]?.id, type: "get_state" },
      { id: requests[1]?.id, type: "prompt", message: "Do the task" },
    ]);
    expect(new Set(requests.map(each => each.id)).size).toBe(2);
  });

  it("offers the leg's host tools between the state and the prompt, on a resumed leg too", () => {
    const spec = specOf({ resume: "s1", prompt: "Round 2" });
    const requests = ompRpcCodec(spec).open(spec, {
      ...leg,
      hostTools: [
        {
          name: "ork_report",
          description: "Report",
          parameters: { type: "object" },
          call: () => Promise.resolve({ content: [] }),
        },
      ],
    });
    expect(requests.map(each => each.frame)).toEqual([
      { id: requests[0]?.id, type: "get_state" },
      {
        id: requests[1]?.id,
        type: "set_host_tools",
        tools: [
          {
            name: "ork_report",
            description: "Report",
            parameters: { type: "object" },
          },
        ],
      },
      { id: requests[2]?.id, type: "prompt", message: "Round 2" },
    ]);
  });

  it("gives a refused `set_host_tools` its error, so the leg's start fails", () => {
    const codec = ompRpcCodec(specOf());
    const id = idAt(codec.open(specOf(), { ...leg, hostTools: [] }), 1);
    expect(
      codec.decode({
        type: "response",
        id,
        command: "set_host_tools",
        success: false,
        error: "unknown command",
      }),
    ).toEqual({ events: [], reply: { id, error: "unknown command" } });
  });

  it("reads a host tool call by its id and answers it with a `host_tool_result`", () => {
    const codec = opened();
    expect(
      codec.decode({
        type: "host_tool_call",
        id: "h1",
        toolCallId: "t1",
        toolName: "ork_report",
        arguments: { summary: "done" },
      }),
    ).toEqual({
      events: [],
      call: { id: "h1", tool: "ork_report", args: { summary: "done" } },
    });
    const call = { id: "h1", tool: "ork_report", args: {} };
    expect(
      codec.callResult(call, { content: [{ type: "text", text: "kept" }] }),
    ).toEqual({
      type: "host_tool_result",
      id: "h1",
      result: { content: [{ type: "text", text: "kept" }] },
    });
    expect(
      codec.callResult(call, {
        content: [{ type: "text", text: "Ork tool failed:\nno" }],
        isError: true,
      }),
    ).toMatchObject({ result: { isError: true } });
  });

  it("ignores a host tool call with no id", () => {
    expect(
      opened().decode({ type: "host_tool_call", toolName: "ork_report" }),
    ).toEqual({ events: [] });
  });

  it("starts the session at the id `get_state` answers with", () => {
    const codec = ompRpcCodec(specOf());
    const requests = codec.open(specOf(), leg);
    const id = idAt(requests, 0);
    expect(
      codec.decode(response(id, "get_state", { sessionId: "s1" })),
    ).toMatchObject({
      reply: { id },
      events: [{ type: "session.started", sessionId: "s1", cwd: "/w" }],
    });
    const prompt = idAt(requests, 1);
    expect(codec.decode(response(prompt, "prompt"))).toEqual({
      events: [],
      reply: { id: prompt },
    });
  });

  it("resumes with the leg's own prompt", () => {
    const spec = specOf({ resume: "s1", prompt: "Round 2" });
    const [, prompt] = ompRpcCodec(spec).open(spec, leg);
    expect(prompt?.frame).toMatchObject({ type: "prompt", message: "Round 2" });
  });

  it("resumes a pause's deferral with a message to make the held call again, never the prompt", () => {
    const spec = specOf({ resume: "s1", prompt: "Round 2" });
    const [, prompt] = ompRpcCodec(spec).open(spec, {
      ...leg,
      deferredFor: "pause",
    });
    expect(prompt?.frame).toMatchObject({
      type: "prompt",
      message: OMP_PAUSE_MESSAGE,
    });
    expect(OMP_PAUSE_MESSAGE).toMatch(/^Ork paused this node/u);
  });

  it("resumes a slot's deferral saying the call waited for a heavy slot, not a pause", () => {
    const spec = specOf({ resume: "s1", prompt: "Round 2" });
    const [, prompt] = ompRpcCodec(spec).open(spec, {
      ...leg,
      deferredFor: "slot",
    });
    expect(prompt?.frame).toMatchObject({
      type: "prompt",
      message: OMP_SLOT_MESSAGE,
    });
    expect(OMP_SLOT_MESSAGE).toContain("slot is now taken");
    expect(OMP_SLOT_MESSAGE).not.toMatch(/paused/u);
  });

  it("asks a fork its question", () => {
    const spec = specOf({ resume: "s1", fork: true, prompt: "Why?" });
    const [, prompt] = ompRpcCodec(spec).open(spec, leg);
    expect(prompt?.frame).toMatchObject({ type: "prompt", message: "Why?" });
  });

  it("steers a message and reads its response by id", () => {
    const codec = opened();
    const steer = codec.message("also check b.txt");
    expect(steer.frame).toEqual({
      id: steer.id,
      type: "steer",
      message: "also check b.txt",
    });
    expect(
      codec.decode({ type: "queue_update", steering: ["also check b.txt"] }),
    ).toEqual({ events: [] });
    expect(codec.decode(response(steer.id, "steer"))).toEqual({
      events: [],
      reply: { id: steer.id },
    });
  });

  it("gives a refused request's error to its reply", () => {
    const codec = opened();
    const steer = codec.message("x");
    expect(
      codec.decode({
        type: "response",
        id: steer.id,
        command: "steer",
        success: false,
        error: "not streaming",
      }),
    ).toEqual({ events: [], reply: { id: steer.id, error: "not streaming" } });
  });

  it("aborts with an `abort` frame and ends interrupted once settled", () => {
    const codec = opened();
    const abort = codec.interrupt();
    expect(abort.frame).toEqual({ id: abort.id, type: "abort" });
    const decoded = decodeAll(codec, [
      response(abort.id, "abort"),
      promptResult("aborted", true),
      SETTLED,
    ]);
    expect(decoded[0]?.reply).toEqual({ id: abort.id });
    expect(finished(eventsOf(decoded))).toMatchObject([
      { end: { kind: "interrupted" }, sessionId: "s1" },
    ]);
  });

  it("asks about the call before an approval, and answers Approve", () => {
    const codec = opened();
    const decoded = decodeAll(codec, [
      start("t1", "write", { path: "a.txt", content: "x" }),
      select("u1", SPIKE_OPTIONS),
    ]);
    const ask = decoded[1]?.ask;
    expect(ask).toEqual({
      id: "u1",
      tool: "Write",
      args: { path: "a.txt", content: "x" },
    });
    expect(
      codec.answer({ id: "u1", tool: "Write", args: {} }, "allow"),
    ).toEqual({ type: "extension_ui_response", id: "u1", value: "Approve" });
  });

  it("answers a denial Deny, never for the whole session", () => {
    const codec = opened();
    expect(codec.answer({ id: "u2", tool: "Write", args: {} }, "deny")).toEqual(
      {
        type: "extension_ui_response",
        id: "u2",
        value: "Deny",
      },
    );
  });

  it("cancels a select with no Approve and Deny, and never asks", () => {
    const codec = opened();
    const decoded = decodeAll(codec, [
      start("t1", "write", { path: "a.txt" }),
      select("u3", ["Yes", "No"]),
    ]);
    expect(decoded[1]).toEqual({
      events: [],
      write: [{ type: "extension_ui_response", id: "u3", cancelled: true }],
    });
  });

  it("cancels an approval with no call before it", () => {
    const codec = opened();
    const decoded = decodeAll(codec, [
      start("t1", "write", {}),
      {
        type: "tool_execution_end",
        toolCallId: "t1",
        result: {},
        isError: false,
      },
      select("u4", SPIKE_OPTIONS),
    ]);
    expect(decoded[2]).toEqual({
      events: [],
      write: [{ type: "extension_ui_response", id: "u4", cancelled: true }],
    });
  });

  it("pairs approvals with their calls first in, first out", () => {
    const codec = opened();
    const decoded = decodeAll(codec, [
      start("t1", "write", { path: "a.txt" }),
      start("t2", "bash", { command: "ls" }),
      select("u5", SPIKE_OPTIONS),
      select("u6", SPIKE_OPTIONS),
    ]);
    expect([decoded[2]?.ask, decoded[3]?.ask]).toEqual([
      { id: "u5", tool: "Write", args: { path: "a.txt" } },
      { id: "u6", tool: "Bash", args: { command: "ls" } },
    ]);
  });

  it("drops an ended call from the queue, so the next approval names the call after it", () => {
    const codec = opened();
    const decoded = decodeAll(codec, [
      start("t1", "write", { path: "a.txt" }),
      start("t2", "bash", { command: "ls" }),
      { type: "tool_execution_end", toolCallId: "t1", result: {} },
      select("u7", SPIKE_OPTIONS),
      select("u8", SPIKE_OPTIONS),
    ]);
    expect(decoded[3]?.ask).toEqual({
      id: "u7",
      tool: "Bash",
      args: { command: "ls" },
    });
    expect(decoded[4]?.write).toEqual([
      { type: "extension_ui_response", id: "u8", cancelled: true },
    ]);
  });

  it("takes no call for a select it cannot read", () => {
    const codec = opened();
    const decoded = decodeAll(codec, [
      start("t1", "write", { path: "a.txt" }),
      select("u9", ["Yes", "No"]),
      select("u10", SPIKE_OPTIONS),
    ]);
    expect(decoded[2]?.ask).toEqual({
      id: "u10",
      tool: "Write",
      args: { path: "a.txt" },
    });
  });

  it("ignores a request of another method", () => {
    const codec = opened();
    expect(
      codec.decode({
        type: "extension_ui_request",
        id: "w1",
        method: "setWidget",
        key: "status",
      }),
    ).toEqual({ events: [] });
  });

  it("does not end at a turn's result while the session can wake", () => {
    const codec = opened();
    const early = decodeAll(codec, [
      assistantEnd("started"),
      promptResult("completed", false),
    ]);
    expect(finished(eventsOf(early))).toEqual([]);
    const late = decodeAll(codec, [
      assistantEnd("done"),
      promptResult("completed", true),
      SETTLED,
    ]);
    expect(finished(eventsOf(late))).toMatchObject([
      {
        end: { kind: "no_report" },
        sessionId: "s1",
        text: "done",
        usage: { costUsd: 0.002, inputTokens: 20, outputTokens: 10 },
      },
    ]);
  });

  it("gives each request's usage as print mode does", () => {
    const codec = opened();
    expect(codec.decode(assistantEnd("hi")).usage).toMatchObject({
      costUsd: 0.001,
      inputTokens: 10,
      turns: 1,
    });
  });

  it("ends at the cost cap a prompt's error names", () => {
    const codec = opened();
    const decoded = decodeAll(codec, [
      promptResult("error", true, {
        code: "cost_cap",
        message: "Session cost limit reached",
      }),
      SETTLED,
    ]);
    expect(finished(eventsOf(decoded))).toMatchObject([
      { end: { kind: "budget_limit" }, errors: ["Session cost limit reached"] },
    ]);
  });

  it("fails a prompt's other error", () => {
    const codec = opened();
    const decoded = decodeAll(codec, [
      promptResult("error", true, {
        code: "internal",
        message: "the tool broke",
      }),
      SETTLED,
    ]);
    expect(finished(eventsOf(decoded))).toMatchObject([
      { end: { kind: "driver_crashed" }, errors: ["the tool broke"] },
    ]);
  });

  it("fails the leg at a chunked frame, naming the limit", () => {
    const codec = opened();
    expect(
      codec.decode({ type: "frame_chunk", id: "c1", index: 0, data: "…" }).fail,
    ).toContain("1048576-byte frame limit");
  });
});
