/**
 * @file Tests that arguments an Ork tool refuses are marked as the agent's
 *   mistake: the tool's answer starts with `BAD_ARGUMENTS`, and the Claude Code
 *   OpenCode and Command Code decoders set the `tool.result`'s `fault` from it,
 *   and only from it. They also keep the `message` of an Ork-marked refusal or
 *   failure (`orkMessage`: first line, clipped), and none of another tool's
 *   error or Claude Code's own validation text. A call a driver's own guard
 *   refused is marked `fault: "refused"` by the Command Code and `omp`
 *   decoders, and an ordinary failure is not.
 */

import type { HumanChannel } from "@krapht/ork-core";
import { describe, expect, it } from "vitest";

import { normalize } from "../src/adapters/claude-code-events.ts";
import { commandCodeDecoder } from "../src/adapters/command-code-events.ts";
import { ompDecoder } from "../src/adapters/omp-events.ts";
import { OMP_PAUSED } from "../src/adapters/omp-guard.ts";
import { decodeOpenCodeLine } from "../src/adapters/open-code-events.ts";
import { orkTools } from "../src/index.ts";
import { BAD_ARGUMENTS, ORK_FAILED, orkMessage } from "../src/tools/tool.ts";

const human: HumanChannel = {
  ask: () => Promise.resolve(""),
  permit: () => Promise.resolve({ allow: true }),
};

/** What the Command Code decoder makes of one tool frame. */
const frame = (type: string, error: string) =>
  commandCodeDecoder().decode(
    JSON.stringify({
      type: "event",
      event: {
        type,
        toolCallId: "t",
        toolName: "mcp__ork__extract",
        error,
      },
    }),
  ).events;

const claudeResult = (content: unknown, isError: boolean) =>
  normalize({
    type: "user",
    message: {
      content: [
        { type: "tool_result", tool_use_id: "t", is_error: isError, content },
      ],
    },
  });

const openCodeResult = (state: Record<string, unknown>) =>
  decodeOpenCodeLine(
    JSON.stringify({
      type: "tool_use",
      part: { id: "t", tool: "ork_extract", state: { input: {}, ...state } },
    }),
  ).events.at(-1);

/** A Command Code frame for a shell call, as the decoder gives it. */
const shellFrame = (event: Record<string, unknown>) =>
  commandCodeDecoder().decode(
    JSON.stringify({
      type: "event",
      event: { toolCallId: "t", toolName: "shell", ...event },
    }),
  ).events;

/** An `omp` bash call that ended with `text`, as the decoder gives it. */
const ompEnd = (isError: boolean, text: string) =>
  ompDecoder({ cwd: "/w", model: "m" })
    .decode(
      JSON.stringify({
        type: "tool_execution_end",
        toolCallId: "t",
        toolName: "bash",
        result: { content: [{ type: "text", text }] },
        isError,
      }),
    )
    .events.at(-1);

const NOT_ALLOWED = "Ork: shell is not allowed for this node. Do not retry it.";
const SHELL_READ = "Ork refuses `cat` here: use the extract tool instead.";

const REFUSED = `${BAD_ARGUMENTS}\nsteps: Required\nmore`;
const FAILED = `${ORK_FAILED}\nnot a git repository`;
const VALIDATION =
  "<tool_use_error>InputValidationError: extract failed due to the following issue</tool_use_error>";

describe("an Ork tool's message", () => {
  it("is the first line after either marker", () => {
    expect([orkMessage(REFUSED), orkMessage(FAILED)]).toEqual([
      "steps: Required",
      "not a git repository",
    ]);
  });

  it("is clipped to 1000 characters", () => {
    expect(orkMessage(`${ORK_FAILED}\n${"x".repeat(1400)}`)).toBe(
      "x".repeat(1000),
    );
  });

  it("is not there for unmarked or empty text", () => {
    expect([orkMessage(VALIDATION), orkMessage(ORK_FAILED)]).toEqual([
      undefined,
      undefined,
    ]);
  });

  it("is not there when another tool's error only quotes a marker", () => {
    expect(orkMessage(`bash: exit 1\n${ORK_FAILED} quoted`)).toBeUndefined();
  });
});

describe("arguments an Ork tool refuses", () => {
  it("are answered with the marker and nothing runs", async () => {
    const tool = orkTools({
      nodeId: "n",
      driver: "claude-code",
      ports: { human },
      cwd: process.cwd(),
    }).find(t => t.name === "extract");
    const result = await tool?.call({ programs: [{ step: "read" }] });
    expect(result?.isError).toBe(true);
    expect(JSON.stringify(result)).toContain(BAD_ARGUMENTS);
  });

  it("are the agent's fault on Claude Code, as text or text parts", () => {
    const refused = {
      type: "tool.result",
      id: "t",
      isError: true,
      fault: "arguments",
      message: "steps: Required",
    };
    expect(claudeResult(REFUSED, true)).toEqual([refused]);
    expect(claudeResult([{ type: "text", text: REFUSED }], true)).toEqual([
      refused,
    ]);
  });

  it("leave any other failure, or a success, without a fault", () => {
    expect(claudeResult("git failed", true)).toEqual([
      { type: "tool.result", id: "t", isError: true },
    ]);
    expect(claudeResult(BAD_ARGUMENTS, false)).toEqual([
      { type: "tool.result", id: "t", isError: false },
    ]);
  });

  it("keep an Ork failure's message on Claude Code, and none of its own validation text or a success", () => {
    expect(claudeResult(FAILED, true)).toEqual([
      {
        type: "tool.result",
        id: "t",
        isError: true,
        message: "not a git repository",
      },
    ]);
    expect(claudeResult(VALIDATION, true)).toEqual([
      { type: "tool.result", id: "t", isError: true },
    ]);
    expect(claudeResult(FAILED, false)).toEqual([
      { type: "tool.result", id: "t", isError: false },
    ]);
  });

  it("are the agent's fault on OpenCode", () => {
    expect(
      openCodeResult({ status: "error", error: `${BAD_ARGUMENTS} steps` }),
    ).toEqual({
      type: "tool.result",
      id: "t",
      isError: true,
      fault: "arguments",
      message: "steps",
    });
    expect(openCodeResult({ status: "error", error: "timed out" })).toEqual({
      type: "tool.result",
      id: "t",
      isError: true,
    });
  });

  it("keep an Ork failure's message on OpenCode, and none of a success", () => {
    expect(openCodeResult({ status: "error", output: FAILED })).toEqual({
      type: "tool.result",
      id: "t",
      isError: true,
      message: "not a git repository",
    });
    expect(openCodeResult({ status: "completed", output: FAILED })).toEqual({
      type: "tool.result",
      id: "t",
      isError: false,
    });
  });

  it("are the agent's fault on Command Code, only in a tool_errored frame", () => {
    expect(frame("tool_errored", REFUSED)).toEqual([
      {
        type: "tool.result",
        id: "t",
        isError: true,
        fault: "arguments",
        message: "steps: Required",
      },
    ]);
    expect(frame("tool_errored", "git failed")).toEqual([
      { type: "tool.result", id: "t", isError: true },
    ]);
    expect(frame("tool_denied", BAD_ARGUMENTS)).toEqual([
      { type: "tool.result", id: "t", isError: true },
    ]);
  });

  it("keep an Ork failure's message on Command Code, only in a tool_errored frame", () => {
    expect(frame("tool_errored", FAILED)).toEqual([
      {
        type: "tool.result",
        id: "t",
        isError: true,
        message: "not a git repository",
      },
    ]);
    expect(frame("tool_denied", FAILED)).toEqual([
      { type: "tool.result", id: "t", isError: true },
    ]);
  });
});

describe("a call a driver's own guard refused", () => {
  it("is marked refused on Command Code when the session mod blocked it", () => {
    expect([
      ...shellFrame({ type: "tool_hook_blocked", hookOutput: NOT_ALLOWED }),
      ...shellFrame({ type: "tool_hook_blocked", hookOutput: SHELL_READ }),
    ]).toEqual([
      { type: "tool.result", id: "t", isError: true, fault: "refused" },
      { type: "tool.result", id: "t", isError: true, fault: "refused" },
    ]);
  });

  it("is not marked on Command Code for a failed command or another hook's block", () => {
    expect([
      ...shellFrame({ type: "tool_errored", error: NOT_ALLOWED }),
      ...shellFrame({
        type: "tool_hook_blocked",
        hookOutput: "Blocked by a pre-tool hook.",
      }),
    ]).toEqual([
      { type: "tool.result", id: "t", isError: true },
      { type: "tool.result", id: "t", isError: true },
    ]);
  });

  it("is marked refused on omp when the guard blocked it", () => {
    expect([ompEnd(true, NOT_ALLOWED), ompEnd(true, SHELL_READ)]).toEqual([
      { type: "tool.result", id: "t", isError: true, fault: "refused" },
      { type: "tool.result", id: "t", isError: true, fault: "refused" },
    ]);
  });

  it("is not marked on omp for a failed command, a pause, or output that only reads like a refusal", () => {
    expect([
      ompEnd(true, "Error: exit 1"),
      ompEnd(true, OMP_PAUSED),
      ompEnd(false, NOT_ALLOWED),
    ]).toEqual([
      { type: "tool.result", id: "t", isError: true },
      { type: "tool.result", id: "t", isError: true },
      { type: "tool.result", id: "t", isError: false },
    ]);
  });
});
