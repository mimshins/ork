/**
 * @file Tests that arguments an Ork tool refuses are marked as the agent's
 *   mistake: the tool's answer starts with `BAD_ARGUMENTS`, and the Claude Code
 *   OpenCode and Command Code decoders set the `tool.result`'s `fault` from it,
 *   and only from it. They also keep the `message` of an Ork-marked refusal or
 *   failure (`orkMessage`: first line, clipped), and none of another tool's
 *   error or Claude Code's own validation text.
 */

import type { HumanChannel } from "@krapht/ork-core";
import { describe, expect, it } from "vitest";

import { normalize } from "../src/adapters/claude-code-events.ts";
import { commandCodeDecoder } from "../src/adapters/command-code-events.ts";
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
