/**
 * @file The `open-code` adapter's decoder and usage reader. `opencode run
 *   --format json` prints one JSON object per line, `{type, timestamp,
 *   sessionID, part}` (2.1.0, read from its source): `step_start`, `text`,
 *   `tool_use` (a finished call, `state.status` `completed` or `error`),
 *   `step_finish` (`cost` in dollars, `tokens`) and `error`. There is no result
 *   line: the last `text` is the final text and the process's exit ends the
 *   session. Tool names come back in Claude Code's words (`shell` is `Bash`,
 *   `ork_report` is `mcp__ork__report`), the words a node's rules use.
 */

import type { RuntimeEvent, SessionSpec, SessionUsage } from "@krapht/ork-core";

import type { Decoded, LegDecoder, UsageReader } from "../adapter.ts";
import { ORK_SERVER, toolId } from "../tools/tool.ts";

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const get = (value: unknown, key: string): unknown =>
  isObject(value) ? value[key] : undefined;

const num = (value: unknown): number => (typeof value === "number" ? value : 0);

const str = (value: unknown): string =>
  typeof value === "string" ? value : "";

/** OpenCode's built-in tools, by Claude Code's names. */
const TOOL_NAMES: Readonly<Record<string, string>> = {
  shell: "Bash",
  read: "Read",
  edit: "Edit",
  write: "Write",
  patch: "Edit",
  glob: "Glob",
  grep: "Grep",
  webfetch: "WebFetch",
  websearch: "WebSearch",
  subagent: "Task",
  skill: "Skill",
  todowrite: "TodoWrite",
};

const ORK_PREFIX = `${ORK_SERVER}_`;

/** A tool's name as a node's rules and Ork's views say it. */
export const toolName = (name: string): string =>
  TOOL_NAMES[name] ??
  (name.startsWith(ORK_PREFIX) ? toolId(name.slice(ORK_PREFIX.length)) : name);

const parseLine = (line: string): unknown => {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return undefined;
  }
};

/** One `step_finish`'s spending, as a whole session's of one turn. */
const stepUsage = (part: unknown): SessionUsage => {
  const tokens = get(part, "tokens");
  const cache = get(tokens, "cache");
  return {
    costUsd: num(get(part, "cost")),
    inputTokens: num(get(tokens, "input")),
    // Reasoning is billed as output.
    outputTokens: num(get(tokens, "output")) + num(get(tokens, "reasoning")),
    cacheReadTokens: num(get(cache, "read")),
    cacheWriteTokens: num(get(cache, "write")),
    turns: 1,
    durationMs: 0,
  };
};

/** Two spans of one session, as one: OpenCode reports each step's own cost. */
export const sumUsage = (a: SessionUsage, b: SessionUsage): SessionUsage => ({
  costUsd: a.costUsd + b.costUsd,
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  turns: a.turns + b.turns,
  durationMs: a.durationMs + b.durationMs,
});

export const openCodeUsage: UsageReader = { dollars: true, combine: sumUsage };

const NONE: SessionUsage = {
  costUsd: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  turns: 0,
  durationMs: 0,
};

/** One finished tool call: its call and its result. */
const toolEvents = (part: unknown): RuntimeEvent[] => {
  const id = str(get(part, "id")) || str(get(part, "partID"));
  const state = get(part, "state");
  const input = get(state, "input");
  return [
    {
      type: "tool.called",
      id,
      name: toolName(str(get(part, "tool"))),
      input: isObject(input) ? input : {},
    },
    { type: "tool.result", id, isError: get(state, "status") === "error" },
  ];
};

/** What one line says by itself: text and finished tool calls. */
export const decodeOpenCodeLine = (line: string): Decoded => {
  const message = parseLine(line);
  const part = get(message, "part");
  switch (get(message, "type")) {
    case "text": {
      const said = str(get(part, "text"));
      return {
        events:
          said.trim() === "" ? [] : [{ type: "assistant.text", text: said }],
      };
    }
    case "tool_use": {
      return { events: toolEvents(part) };
    }
    default: {
      return { events: [] };
    }
  }
};

/**
 * A decoder for one leg of a session: it starts the session at the first line
 * that names it, and keeps the last text, the steps' usage and the errors for
 * the end.
 */
export const openCodeDecoder = (spec: SessionSpec): LegDecoder => {
  const began = Date.now();
  let sessionId = "";
  let text = "";
  let usage = NONE;
  const errors: string[] = [];
  return {
    decode: line => {
      const message = parseLine(line);
      if (!isObject(message)) return { events: [] };
      const events: RuntimeEvent[] = [];
      if (sessionId === "" && str(message["sessionID"]) !== "") {
        sessionId = str(message["sessionID"]);
        events.push({
          type: "session.started",
          sessionId,
          model: spec.model ?? "default",
          cwd: spec.cwd,
        });
      }
      const said = decodeOpenCodeLine(line).events;
      events.push(...said);
      const last = said.findLast(event => event.type === "assistant.text");
      if (last !== undefined) text = last.text;
      switch (message["type"]) {
        case "step_finish": {
          usage = sumUsage(usage, stepUsage(message["part"]));
          break;
        }
        case "error": {
          const error = message["error"];
          errors.push(
            str(get(get(error, "data"), "message")) ||
              str(get(error, "message")) ||
              str(get(error, "name")) ||
              "error",
          );
          break;
        }
        default: {
          break;
        }
      }
      return { events };
    },
    exit: code => {
      // A failure that said nothing is explained from stderr instead.
      if (code !== 0 && errors.length === 0) return [];
      return [
        {
          type: "session.finished",
          outcome: {
            subtype: code === 0 ? "success" : "error_during_execution",
            sessionId,
            report: null,
            text,
            usage: { ...usage, durationMs: Date.now() - began },
            errors,
          },
        },
      ];
    },
  };
};
