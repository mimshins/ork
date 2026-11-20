/**
 * @file The `codex app-server` codec (RFC-027), on frames in the shapes of
 *   codex-cli 0.169.0's generated schema
 *   (`fixtures/codex-app-server-session.ts`): the handshake of a first, a
 *   resumed and a forked leg, a handshake refused, a message as `turn/steer`,
 *   an interrupt and its end, command and file-change approvals answered accept
 *   or decline only, the server requests it refuses, usage, the ends of a
 *   completed and a failed turn, and the frames it ignores.
 */

import type {
  RuntimeEvent,
  SessionOutcome,
  SessionSpec,
} from "@krapht/ork-core";
import { describe, expect, it } from "vitest";

import type { DecodedFrame, Frame } from "../src/adapter.ts";
import {
  codexRpcCodec,
  type CodexRpcCodec,
} from "../src/adapters/codex-rpc.ts";
import {
  AGENT_MESSAGE_COMPLETED,
  AGENT_MESSAGE_DELTA,
  AUTH_REFRESH,
  COMMAND_APPROVAL,
  COMMAND_COMPLETED,
  COMMAND_DECLINED,
  COMMAND_STARTED,
  CWD,
  ELICITATION,
  ELICITATION_REFUSED,
  ERROR_FINAL,
  ERROR_RETRYING,
  FILE_CHANGE_APPROVAL,
  FILE_CHANGE_GRANT_ROOT,
  FILE_CHANGE_STARTED,
  FORKED_THREAD_ID,
  HOOK_COMPLETED,
  INITIALIZE_REPLY,
  INITIALIZED,
  LEGACY_DENIED,
  LEGACY_EXEC_APPROVAL,
  PERMISSIONS,
  PERMISSIONS_REFUSED,
  REPORT_COMPLETED,
  type RpcReply,
  THREAD_FORK,
  THREAD_FORK_REPLY,
  THREAD_ID,
  THREAD_RESUME,
  THREAD_START,
  THREAD_START_REPLY,
  THREAD_STARTED,
  TOKEN_USAGE,
  TOOL_CALL,
  TOOL_CALL_REFUSED,
  TURN_COMPLETED,
  TURN_FAILED,
  TURN_FAILED_OTHER,
  TURN_INTERRUPT,
  TURN_INTERRUPTED,
  TURN_START,
  TURN_START_REPLY,
  TURN_STARTED,
  TURN_STEER,
  TURN_STEER_NO_TURN,
  USER_INPUT,
  accept,
  decline,
} from "./fixtures/codex-app-server-session.ts";

const specOf = (over: Partial<SessionSpec> = {}): SessionSpec => ({
  nodeId: "codex",
  cwd: CWD,
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

const OPTIONS = {
  sandbox: "workspace-write",
  effort: "medium",
  config: { bypass_hook_trust: true },
} as const;

/** A frame without its id: Ork's ids are the codec's own. */
const shape = (frame: Frame | undefined) => ({
  method: frame?.["method"],
  params: frame?.["params"],
});

/** Codex's reply, to the request Ork wrote with `id`. */
const to = (reply: RpcReply, id: unknown): Frame => ({ ...reply, id });

const FIRST_LEG = { model: "gpt-5.1-codex" };

/** A handshake run to the turn's start, and what each step said. */
const handshake = (
  over: Partial<SessionSpec> = FIRST_LEG,
  threadReply: RpcReply = THREAD_START_REPLY,
) => {
  const spec = specOf(over);
  const codec = codexRpcCodec(spec, OPTIONS);
  const opened = codec.open(spec, leg);
  const initialized = codec.decode(to(INITIALIZE_REPLY, opened[0]?.id));
  const threadFrame = initialized.write?.[1];
  const threaded = codec.decode(to(threadReply, threadFrame?.["id"]));
  const turnFrame = threaded.write?.[0];
  const turnReply = codec.decode(to(TURN_START_REPLY, turnFrame?.["id"]));
  const turned = codec.decode(TURN_STARTED);
  return {
    codec,
    opened,
    initialized,
    threadFrame,
    threaded,
    turnFrame,
    turnReply,
    turned,
  };
};

/** The codec at a running turn. */
const running = (): CodexRpcCodec => handshake().codec;

const finished = (decoded: DecodedFrame): SessionOutcome | undefined =>
  decoded.events.flatMap((event: RuntimeEvent) =>
    event.type === "session.finished" ? [event.outcome] : [],
  )[0];

const all = (codec: CodexRpcCodec, frames: readonly Frame[]): RuntimeEvent[] =>
  frames.flatMap(frame => codec.decode(frame).events);

describe("the codex app-server codec", () => {
  it("is ready at spawn and waits for a turn to take a message", () => {
    const { codec } = handshake();
    expect(codec.readyAtSpawn).toBe(true);
    expect(codec.waitsForTurn).toBe(true);
  });

  it("opens with initialize, then initialized and thread/start, then turn/start", () => {
    const { opened, initialized, threaded, turnFrame, turnReply, turned } =
      handshake();
    expect(opened).toHaveLength(1);
    expect(opened[0]?.frame).toMatchObject({
      id: opened[0]?.id,
      method: "initialize",
      params: {
        clientInfo: { name: "ork" },
        capabilities: { experimentalApi: false },
      },
    });
    expect(initialized.write?.[0]).toEqual(INITIALIZED);
    expect(shape(initialized.write?.[1])).toEqual(shape(THREAD_START));
    expect(threaded.events).toEqual([
      {
        type: "session.started",
        sessionId: THREAD_ID,
        model: "gpt-5.1-codex",
        cwd: CWD,
      },
    ]);
    expect(shape(turnFrame)).toEqual(shape(TURN_START));
    expect(turnReply.turn).toBeUndefined();
    expect(turned.turn).toBe(true);
  });

  it("resumes a thread by id, without instructions, with the message as the prompt", () => {
    const { threadFrame, turnFrame } = handshake({
      resume: THREAD_ID,
      prompt: "Go on",
    });
    expect(shape(threadFrame)).toEqual(shape(THREAD_RESUME));
    expect(turnFrame?.["params"]).toMatchObject({
      threadId: THREAD_ID,
      input: [{ type: "text", text: "Go on" }],
    });
  });

  it("forks a thread, and runs the turn on the fork's id", () => {
    const { threadFrame, threaded, turnFrame } = handshake(
      { resume: THREAD_ID, fork: true },
      THREAD_FORK_REPLY,
    );
    expect(shape(threadFrame)).toEqual(shape(THREAD_FORK));
    expect(threaded.events[0]).toMatchObject({ sessionId: FORKED_THREAD_ID });
    expect(turnFrame?.["params"]).toMatchObject({ threadId: FORKED_THREAD_ID });
  });

  it("fails the leg when Codex refuses a step of the handshake", () => {
    const spec = specOf();
    const codec = codexRpcCodec(spec, OPTIONS);
    const [init] = codec.open(spec, leg);
    const refused = codec.decode({
      id: init?.id,
      error: { code: -32_600, message: "bad config" },
    });
    expect(refused.reply).toEqual({ id: init?.id, error: "bad config" });
    expect(refused.fail).toBe("codex refused initialize: bad config");
  });

  it("fails the leg when the thread's start is refused", () => {
    const spec = specOf();
    const codec = codexRpcCodec(spec, OPTIONS);
    const [init] = codec.open(spec, leg);
    const thread = codec.decode(to(INITIALIZE_REPLY, init?.id)).write?.[1];
    const refused = codec.decode({
      id: thread?.["id"],
      error: { code: -32_600, message: "no such model" },
    });
    expect(refused.fail).toBe("codex refused thread/start: no such model");
  });

  it("ignores a turn of another thread", () => {
    const codec = running();
    const other = { threadId: "thread-sub-agent", turn: { id: "turn-sub" } };
    const started = codec.decode({ method: "turn/started", params: other });
    expect(started).toEqual({ events: [] });
    const ended = codec.decode({
      method: "turn/completed",
      params: { ...other, turn: { id: "turn-sub", status: "completed" } },
    });
    expect(finished(ended)).toBeUndefined();
    const steer = codec.message("Also update the docs");
    expect(steer.frame).toEqual({ id: steer.id, ...shape(TURN_STEER) });
  });

  it("sends a message as turn/steer on the running turn", () => {
    const codec = running();
    const steer = codec.message("Also update the docs");
    expect(steer.frame).toEqual({ id: steer.id, ...shape(TURN_STEER) });
    expect(
      codec.decode({ id: steer.id, result: { turnId: "turn-1" } }),
    ).toEqual({ events: [], reply: { id: steer.id } });
  });

  it("gives a refused steer's error back to its request", () => {
    const codec = running();
    const steer = codec.message("late");
    expect(codec.decode(to(TURN_STEER_NO_TURN, steer.id))).toEqual({
      events: [],
      reply: { id: steer.id, error: "no active turn to steer" },
    });
  });

  it("interrupts the turn, and ends interrupted at its completion", () => {
    const codec = running();
    const stop = codec.interrupt();
    expect(stop.frame).toEqual({ id: stop.id, ...shape(TURN_INTERRUPT) });
    expect(finished(codec.decode(TURN_INTERRUPTED))?.end?.kind).toBe(
      "interrupted",
    );
  });

  it("ends a completed turn with no report of its own, as codex does", () => {
    const codec = running();
    const outcome = finished(codec.decode(TURN_COMPLETED));
    expect(outcome).toMatchObject({
      subtype: "success",
      sessionId: THREAD_ID,
      report: null,
    });
    expect(outcome?.end?.kind).toBe("no_report");
  });

  it("reads tool calls and text in codex's names", () => {
    const codec = running();
    const events = all(codec, [
      COMMAND_STARTED,
      COMMAND_COMPLETED,
      FILE_CHANGE_STARTED,
      REPORT_COMPLETED,
      AGENT_MESSAGE_COMPLETED,
    ]);
    expect(events).toEqual([
      {
        type: "tool.called",
        id: "item-cmd-1",
        name: "Bash",
        input: { command: "pnpm test" },
      },
      { type: "tool.result", id: "item-cmd-1", isError: false },
      {
        type: "tool.called",
        id: "item-file-1",
        name: "Edit",
        input: {
          changes: [expect.objectContaining({ path: "/work/README.md" })],
        },
      },
      {
        type: "tool.called",
        id: "item-report-1",
        name: "mcp__ork__report",
        input: { status: "done", summary: "Did it" },
      },
      { type: "tool.result", id: "item-report-1", isError: false },
      { type: "assistant.text", text: "Done." },
    ]);
    expect(codec.toolsRan()).toBe(true);
  });

  it("reads a declined command as a failed call", () => {
    const codec = running();
    const events = all(codec, [COMMAND_STARTED, COMMAND_DECLINED]);
    expect(events[1]).toMatchObject({ type: "tool.result", isError: true });
  });

  it("asks about a command, and answers accept or decline, never for the session", () => {
    const codec = running();
    const { ask } = codec.decode(COMMAND_APPROVAL);
    expect(ask).toEqual({
      id: "100",
      tool: "Bash",
      args: { command: "pnpm test" },
    });
    expect(
      codec.answer({ id: "100", tool: "Bash", args: {} }, "allow"),
    ).toEqual(accept(100));
    codec.decode({ ...COMMAND_APPROVAL, id: 103 });
    expect(codec.answer({ id: "103", tool: "Bash", args: {} }, "deny")).toEqual(
      decline(103),
    );
  });

  it("declines a command approval it cannot describe as a call", () => {
    const codec = running();
    const stdin = codec.decode({
      ...COMMAND_APPROVAL,
      params: { ...COMMAND_APPROVAL.params, kind: "writeStdin" },
    });
    expect(stdin).toEqual({ events: [], write: [decline(100)] });
  });

  it("asks about a file change with the changes its item started with", () => {
    const codec = running();
    codec.decode(FILE_CHANGE_STARTED);
    const { ask } = codec.decode(FILE_CHANGE_APPROVAL);
    expect(ask).toEqual({
      id: "101",
      tool: "Edit",
      args: {
        changes: [
          {
            path: "/work/README.md",
            kind: { type: "update", move_path: null },
            diff: "@@ -1 +1 @@\n-old\n+new\n",
          },
        ],
      },
    });
    expect(
      codec.answer({ id: "101", tool: "Edit", args: {} }, "allow"),
    ).toEqual(accept(101));
  });

  it("declines a file change whose item it has not seen", () => {
    expect(running().decode(FILE_CHANGE_APPROVAL)).toEqual({
      events: [],
      write: [decline(101)],
    });
  });

  it("declines a file change that asks for a root for the session", () => {
    const codec = running();
    codec.decode(FILE_CHANGE_STARTED);
    expect(codec.decode(FILE_CHANGE_GRANT_ROOT)).toEqual({
      events: [],
      write: [decline(102)],
    });
  });

  it.each([
    ["a host tool call", TOOL_CALL, TOOL_CALL_REFUSED],
    ["an elicitation", ELICITATION, ELICITATION_REFUSED],
    ["a permissions request", PERMISSIONS, PERMISSIONS_REFUSED],
    ["a legacy approval", LEGACY_EXEC_APPROVAL, LEGACY_DENIED],
  ])("refuses %s at once with its own no", (_name, request, refusal) => {
    expect(running().decode(request)).toEqual({
      events: [],
      write: [refusal],
    });
  });

  it.each([
    ["a question for the user", USER_INPUT],
    ["a credential refresh", AUTH_REFRESH],
  ])("refuses %s with an error, never an answer", (_name, request) => {
    const decoded = running().decode(request);
    expect(decoded.ask).toBeUndefined();
    expect(decoded.write).toEqual([
      {
        id: request.id,
        error: {
          code: -32_601,
          message: `Ork does not serve ${request.method}`,
        },
      },
    ]);
  });

  it("counts the leg's usage from the thread's running total", () => {
    const codec = running();
    expect(codec.decode(TOKEN_USAGE).usage).toMatchObject({
      inputTokens: 100,
      cacheReadTokens: 300,
      outputTokens: 100,
    });
    const later = codec.decode({
      ...TOKEN_USAGE,
      params: {
        ...TOKEN_USAGE.params,
        tokenUsage: {
          total: {
            inputTokens: 1500,
            cachedInputTokens: 900,
            outputTokens: 400,
          },
          last: { inputTokens: 300, cachedInputTokens: 100, outputTokens: 100 },
        },
      },
    });
    expect(later.usage).toMatchObject({
      inputTokens: 300,
      cacheReadTokens: 400,
      outputTokens: 200,
    });
    expect(finished(codec.decode(TURN_COMPLETED))?.usage).toMatchObject({
      inputTokens: 300,
      cacheReadTokens: 400,
      outputTokens: 200,
      turns: 1,
    });
  });

  it("ends a failed turn with the kind its error means", () => {
    const outcome = finished(running().decode(TURN_FAILED));
    expect(outcome?.subtype).toBe("error_during_execution");
    expect(outcome?.end?.kind).toBe("plan_limit");
  });

  it("ends a failed turn it cannot classify as unknown, with its words", () => {
    const outcome = finished(running().decode(TURN_FAILED_OTHER));
    expect(outcome?.end?.kind).toBe("unknown");
    expect(outcome?.errors).toContain("sandbox setup failed");
  });

  it("keeps a final error's words and drops one Codex retries", () => {
    const codec = running();
    expect(codec.decode(ERROR_RETRYING)).toEqual({ events: [] });
    codec.decode(ERROR_FINAL);
    expect(finished(codec.decode(TURN_FAILED_OTHER))?.errors).toEqual([
      "You've hit your usage limit.",
      "sandbox setup failed",
    ]);
  });

  it.each([
    ["a delta", AGENT_MESSAGE_DELTA],
    ["a hook's run", HOOK_COMPLETED],
    ["the thread's start", THREAD_STARTED],
  ])("ignores %s", (_name, frame) => {
    expect(running().decode(frame)).toEqual({ events: [] });
  });
});
