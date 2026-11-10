/**
 * @file The `command-code` adapter's `EventDecoder` and `UsageReader`: maps
 *   Command Code's `--output-format json` lines (`{"type":"event"}` frames,
 *   then one `{"type":"result"}` line; measured on 1.88.5,
 *   specs/architecture.md, "Command Code") to Ork's runtime events. Tool names
 *   are given Ork's (Claude Code's) names, so logs and the node's rules read
 *   the same on every driver. One decoder reads one leg: the session id comes
 *   in an early `run_start` frame and the result line counts no turns, so it
 *   keeps both.
 */

import type { RuntimeEvent, SessionUsage } from "@krapht/ork-core";

import type { EventDecoder, UsageReader } from "../adapter.ts";
import { addUsage } from "./claude-code-events.ts";

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const num = (value: unknown): number => (typeof value === "number" ? value : 0);

const str = (value: unknown): string =>
  typeof value === "string" ? value : "";

/** Command Code's own tool names, as Ork (and Claude Code) names them. */
export const COMMAND_CODE_TOOLS: Readonly<Record<string, string>> = {
  shell: "Bash",
  shell_command: "Bash",
  read_file: "Read",
  read_multiple_files: "Read",
  read_directory: "Read",
  glob: "Glob",
  grep: "Grep",
  edit_file: "Edit",
  write_file: "Write",
  web_fetch: "WebFetch",
  web_search: "WebSearch",
  agent: "Task",
};

/** A tool's name as Ork shows it; MCP and unknown names stay as they are. */
export const orkToolName = (name: string): string =>
  COMMAND_CODE_TOOLS[name] ?? name;

/** The result line's subtypes, as Ork's outcome names them. */
const SUBTYPES: Readonly<Record<string, string>> = {
  success: "success",
  max_turns: "error_max_turns",
  error: "error_during_execution",
};

/** The text blocks of a `message_end` frame's content. */
const textOf = (content: unknown): string =>
  (Array.isArray(content) ? content : [])
    .filter(item => isObject(item))
    .filter(block => block["type"] === "text")
    .map(block => str(block["text"]))
    .join("");

/** The frames that end a tool call as an error: failed, denied, or blocked. */
const REFUSED = new Set(["tool_errored", "tool_denied", "tool_hook_blocked"]);

const parseLine = (line: string): unknown => {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return undefined;
  }
};

/** A decoder for one leg of a Command Code session. */
export const commandCodeDecoder = (): EventDecoder => {
  let sessionId = "";
  let turns = 0;

  const frame = (event: Json): RuntimeEvent[] => {
    const type = event["type"];
    const id = str(event["toolCallId"]);
    const name = orkToolName(str(event["toolName"]));
    if (type === "run_start") {
      sessionId = str(event["sessionId"]);
      return [{ type: "session.started", sessionId, model: "" }];
    }
    if (type === "turn_start") turns += 1;
    if (type === "message_end") {
      const text = textOf(event["content"]);
      return text.trim() === "" ? [] : [{ type: "assistant.text", text }];
    }
    if (type === "tool_queued") {
      const input = event["input"];
      return [
        {
          type: "tool.called",
          id,
          name,
          input: isObject(input) ? input : {},
        },
      ];
    }
    if (type === "tool_completed") {
      return [{ type: "tool.result", id, isError: false }];
    }
    if (typeof type === "string" && REFUSED.has(type)) {
      return [{ type: "tool.result", id, isError: true }];
    }
    // Unknown frames are ignored, as Command Code's docs ask.
    return [];
  };

  const result = (line: Json): RuntimeEvent => {
    const usage = isObject(line["usage"]) ? line["usage"] : {};
    const error = str(line["error"]);
    return {
      type: "session.finished",
      outcome: {
        subtype: SUBTYPES[str(line["subtype"])] ?? "error_during_execution",
        sessionId: str(line["sessionId"]) || sessionId,
        // Command Code holds no report to a schema: Ork's `report` tool does.
        report: null,
        text: str(line["finalText"]),
        usage: {
          costUsd: 0,
          inputTokens: num(usage["inputTokens"]),
          outputTokens: num(usage["outputTokens"]),
          cacheReadTokens: num(usage["cacheReadTokens"]),
          cacheWriteTokens: num(usage["cacheWriteTokens"]),
          turns,
          durationMs: num(line["durationMs"]),
        },
        errors: error === "" ? [] : [error],
      },
    };
  };

  return line => {
    const message = parseLine(line);
    if (!isObject(message)) return { events: [] };
    if (message["type"] === "result") return { events: [result(message)] };
    const event = message["event"];
    return {
      events:
        message["type"] === "event" && isObject(event) ? frame(event) : [],
    };
  };
};

/** Command Code reports tokens, never dollars. */
export const commandCodeUsage: UsageReader = {
  dollars: false,
  combine: (a: SessionUsage, b: SessionUsage) => addUsage(a, b),
};
