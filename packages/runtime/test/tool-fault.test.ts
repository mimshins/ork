/**
 * @file Tests that arguments an Ork tool refuses are marked as the agent's
 *   mistake: the tool's answer starts with `BAD_ARGUMENTS`, and the Claude Code
 *   OpenCode and Command Code decoders set the `tool.result`'s `fault` from it,
 *   and only from it.
 */

import type { HumanChannel } from "@krapht/ork-core";
import { describe, expect, it } from "vitest";

import { normalize } from "../src/adapters/claude-code-events.ts";
import { commandCodeDecoder } from "../src/adapters/command-code-events.ts";
import { decodeOpenCodeLine } from "../src/adapters/open-code-events.ts";
import { orkTools } from "../src/index.ts";
import { BAD_ARGUMENTS } from "../src/tools/tool.ts";

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
    const said = `${BAD_ARGUMENTS}\nsteps: Required`;
    expect(claudeResult(said, true)).toEqual([
      { type: "tool.result", id: "t", isError: true, fault: "arguments" },
    ]);
    expect(claudeResult([{ type: "text", text: said }], true)).toEqual([
      { type: "tool.result", id: "t", isError: true, fault: "arguments" },
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

  it("are the agent's fault on OpenCode", () => {
    expect(
      openCodeResult({ status: "error", error: `${BAD_ARGUMENTS} steps` }),
    ).toEqual({
      type: "tool.result",
      id: "t",
      isError: true,
      fault: "arguments",
    });
    expect(openCodeResult({ status: "error", error: "timed out" })).toEqual({
      type: "tool.result",
      id: "t",
      isError: true,
    });
  });

  it("are the agent's fault on Command Code, only in a tool_errored frame", () => {
    expect(frame("tool_errored", `${BAD_ARGUMENTS}\nsteps: Required`)).toEqual([
      { type: "tool.result", id: "t", isError: true, fault: "arguments" },
    ]);
    expect(frame("tool_errored", "git failed")).toEqual([
      { type: "tool.result", id: "t", isError: true },
    ]);
    expect(frame("tool_denied", BAD_ARGUMENTS)).toEqual([
      { type: "tool.result", id: "t", isError: true },
    ]);
  });
});
