/**
 * @file The `command-code` adapter's `LegDecoder` and `UsageReader`: maps
 *   Command Code's `--output-format json` lines (`{"type":"event"}` frames,
 *   then one `{"type":"result"}` line; measured on 1.88.5,
 *   specs/architecture.md, "Command Code") to Ork's runtime events. Tool names
 *   are given Ork's (Claude Code's) names, so logs and the node's rules read
 *   the same on every driver. One decoder reads one leg: the session id comes
 *   in an early `run_start` frame and the result line counts no turns, so it
 *   keeps both. The result line is held until the process exits: its exit code
 *   says how the session ended (specs/architecture/command-code.md).
 */

import {
  type EndKind,
  endFor,
  type RuntimeEvent,
  type SessionEnd,
  type SessionUsage,
} from "@krapht/ork-core";

import type { LegDecoder, UsageReader } from "../adapter.ts";
import { errorEnd } from "../session-end.ts";
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

/**
 * Command Code's exit codes, by the kind they mean; 0 is a session that ended
 * well and 1 an error its text explains.
 */
export const COMMAND_CODE_EXITS: Readonly<Record<number, EndKind>> = {
  3: "auth",
  // Refused by its server: the account may not use this.
  4: "auth",
  5: "rate_limited",
  6: "provider_unavailable",
  7: "provider_unavailable",
  8: "turn_limit",
  9: "provider_unavailable",
  10: "out_of_credits",
  130: "interrupted",
};

/** What a leg's exit code and result line say went wrong, if anything. */
const signalOf = (code: number | null, error: string): SessionEnd | null => {
  const kind = code === null ? undefined : COMMAND_CODE_EXITS[code];
  if (kind !== undefined) return endFor(kind, {}, error);
  // A clean exit, or a kill after a result that said no error.
  if ((code === 0 || code === null) && error === "") return null;
  return errorEnd(error);
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

/**
 * A decoder for one leg of a Command Code session; its end comes at the exit,
 * from the held result line and the exit code.
 */
export const commandCodeDecoder = (): LegDecoder => {
  let sessionId = "";
  let turns = 0;
  let held: Json | undefined;
  /** The leg's tokens so far, from each `model_request_end` frame. */
  let used: SessionUsage | undefined;

  /** A model request's usage, added to the leg's so far. */
  const requestEnded = (usage: unknown): SessionUsage => {
    const said = isObject(usage) ? usage : {};
    const own: SessionUsage = {
      costUsd: 0,
      inputTokens: num(said["inputTokens"]),
      outputTokens: num(said["outputTokens"]),
      cacheReadTokens: num(said["cacheReadTokens"]),
      cacheWriteTokens: num(said["cacheWriteTokens"]),
      turns,
      durationMs: 0,
    };
    used = used === undefined ? own : { ...addUsage(used, own), turns };
    return used;
  };

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

  const result = (line: Json, code: number | null): RuntimeEvent => {
    const usage = isObject(line["usage"]) ? line["usage"] : {};
    const error = str(line["error"]);
    const subtype = str(line["subtype"]);
    const signal =
      subtype === "max_turns"
        ? endFor("turn_limit", {}, error)
        : signalOf(code, error);
    return {
      type: "session.finished",
      outcome: {
        subtype: SUBTYPES[subtype] ?? "error_during_execution",
        // The report comes through Ork's `report` tool: the runner settles it.
        end: signal ?? endFor("no_report"),
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

  return {
    decode: line => {
      const message = parseLine(line);
      if (!isObject(message)) return { events: [] };
      if (message["type"] === "result") {
        held = message;
        return { events: [] };
      }
      const event = message["event"];
      if (message["type"] !== "event" || !isObject(event))
        return { events: [] };
      return {
        events: frame(event),
        ...(event["type"] === "model_request_end"
          ? { usage: requestEnded(event["usage"]) }
          : {}),
      };
    },
    exit: code => {
      if (held !== undefined) return [result(held, code)];
      // Without a result line, only a known exit code explains the end;
      // anything else is explained from stderr.
      const kind = code === null ? undefined : COMMAND_CODE_EXITS[code];
      return kind === undefined ? [] : [result({ error: "" }, code)];
    },
  };
};

/** Command Code reports tokens, never dollars. */
export const commandCodeUsage: UsageReader = {
  dollars: false,
  combine: (a: SessionUsage, b: SessionUsage) => addUsage(a, b),
};
