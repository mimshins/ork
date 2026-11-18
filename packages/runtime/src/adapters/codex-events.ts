/**
 * @file The `codex` adapter's decoder and usage reader (RFC-024). `codex exec
 *   --json` prints one JSON object a line (measured on 0.169.0 in the RFC's
 *   spike): `thread.started` (`thread_id`, the session id), `turn.started`,
 *   `item.started`/`item.completed` with an `item` of type `agent_message`
 *   (`text`), `command_execution` (`command`, `status` `completed` or
 *   `failed`), `file_change` (`changes[]`) or `mcp_tool_call` (`server`,
 *   `tool`, `arguments`, `error`); then `turn.completed` with the turn's
 *   `usage`, or `turn.failed` (`error.message`). A top-level `error` line also
 *   carries warnings (the hook-trust bypass prints one), so it ends nothing by
 *   itself. There is no result line: the process's exit ends the leg. Tool
 *   names come back in Claude Code's words (a shell command is `Bash`, a patch
 *   is `Edit`, an MCP call `mcp__<server>__<tool>`), the words a node's rules
 *   use.
 */

import {
  endFor,
  type RuntimeEvent,
  type SessionEnd,
  type SessionSpec,
  type SessionUsage,
} from "@krapht/ork-core";

import type { LegDecoder, UsageReader } from "../adapter.ts";
import { classifyProviderError } from "../provider-errors.ts";
import { errorEnd } from "../session-end.ts";
import { isBadArguments } from "../tools/tool.ts";
import { addUsage } from "./claude-code-events.ts";

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const get = (value: unknown, key: string): unknown =>
  isObject(value) ? value[key] : undefined;

const num = (value: unknown): number => (typeof value === "number" ? value : 0);

const str = (value: unknown): string =>
  typeof value === "string" ? value : "";

/** The tool names Codex gives its hook, as Ork (and Claude Code) names them. */
export const CODEX_TOOLS: Readonly<Record<string, string>> = {
  Bash: "Bash",
  apply_patch: "Edit",
};

/** The JSONL items that are tool calls, by Ork's tool name. */
const ITEM_TOOLS: Readonly<Record<string, string>> = {
  command_execution: "Bash",
  file_change: "Edit",
};

/** A tool item's name as Ork shows it; `undefined` for an item that is none. */
const itemTool = (item: unknown): string | undefined => {
  const type = str(get(item, "type"));
  if (type === "mcp_tool_call") {
    return `mcp__${str(get(item, "server"))}__${str(get(item, "tool"))}`;
  }
  return ITEM_TOOLS[type];
};

/** A tool item's input, in the shape the node's rules read. */
const itemInput = (item: unknown): Record<string, unknown> => {
  switch (get(item, "type")) {
    case "command_execution": {
      return { command: str(get(item, "command")) };
    }
    case "file_change": {
      const changes = get(item, "changes");
      return { changes: Array.isArray(changes) ? changes : [] };
    }
    default: {
      const input = get(item, "arguments");
      return isObject(input) ? input : {};
    }
  }
};

/** An MCP call's error text, empty when it has none. */
const mcpError = (item: unknown): string => {
  const error = get(item, "error");
  return isObject(error) ? str(error["message"]) : str(error);
};

/** An MCP call's result text: where Ork's own tools answer bad arguments. */
const mcpText = (item: unknown): string => {
  const content = get(get(item, "result"), "content");
  return (Array.isArray(content) ? content : [])
    .map(block => str(get(block, "text")))
    .join("\n");
};

/** A finished tool item's result. */
const itemResult = (item: unknown, id: string): RuntimeEvent => {
  const error = mcpError(item);
  const bad = isBadArguments(`${error}${mcpText(item)}`);
  return {
    type: "tool.result",
    id,
    isError: get(item, "status") === "failed" || error !== "" || bad,
    ...(bad ? { fault: "arguments" as const } : {}),
  };
};

const parseLine = (line: string): unknown => {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return undefined;
  }
};

/**
 * One `turn.completed`'s usage, as a session's of one turn. `input_tokens` is
 * taken to include the cached part (OpenAI's convention, to confirm on a real
 * `codex`); reasoning is already in `output_tokens`. Codex gives no dollars.
 */
export const codexTurnUsage = (usage: unknown): SessionUsage => ({
  costUsd: 0,
  inputTokens: Math.max(
    0,
    num(get(usage, "input_tokens")) - num(get(usage, "cached_input_tokens")),
  ),
  outputTokens: num(get(usage, "output_tokens")),
  cacheReadTokens: num(get(usage, "cached_input_tokens")),
  cacheWriteTokens: num(get(usage, "cache_write_input_tokens")),
  turns: 1,
  durationMs: 0,
});

/** Codex reports tokens, never dollars. */
export const codexUsage: UsageReader = { dollars: false, combine: addUsage };

/** Nothing spent yet. */
export const NONE: SessionUsage = {
  costUsd: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  turns: 0,
  durationMs: 0,
};

/**
 * The warning `--dangerously-bypass-hook-trust` prints as an `error` line on
 * every leg. shortcut: matched by its words (not measured verbatim in the
 * spike); pin the exact text at the gate run.
 */
const HOOK_TRUST_WARNING = /hooks?\W?trust|bypass-hook-trust/iu;

/** The exit code Codex gives an interrupted session. */
const INTERRUPTED = 130;

/**
 * One leg's decoder, and whether the leg finished a tool call (a shell command,
 * a patch or an MCP call): the hook must have seen each, so a leg that ran one
 * while the hook was never called ran unguarded.
 */
export type CodexDecoder = LegDecoder & { toolsRan: () => boolean };

/**
 * A decoder for one leg of a Codex session: it starts the session at
 * `thread.started` (a fork prints its new id there), and keeps the last text,
 * the turns' usage and the errors for the end, which comes at the exit.
 */
export const codexDecoder = (
  spec: Pick<SessionSpec, "model" | "cwd">,
): CodexDecoder => {
  const began = Date.now();
  let sessionId = "";
  let text = "";
  let usage = NONE;
  let ranTools = false;
  const started = new Set<string>();
  /** Every error line's words; warnings among them until the leg fails. */
  const said: string[] = [];
  let failed: SessionEnd | null = null;

  const saying = (message: string): void => {
    if (message !== "" && !said.includes(message)) said.push(message);
  };

  const item = (type: unknown, value: unknown): RuntimeEvent[] => {
    if (get(value, "type") === "agent_message") {
      const words = str(get(value, "text"));
      if (type !== "item.completed" || words.trim() === "") return [];
      text = words;
      return [{ type: "assistant.text", text: words }];
    }
    const name = itemTool(value);
    if (name === undefined) return [];
    // Codex runs its hook before a call, so a finished one was seen by it.
    ranTools ||= type === "item.completed";
    const id = str(get(value, "id"));
    const call: RuntimeEvent[] = started.has(id)
      ? []
      : [{ type: "tool.called", id, name, input: itemInput(value) }];
    started.add(id);
    return type === "item.completed" ? [...call, itemResult(value, id)] : call;
  };

  /** The error lines' words, without the warning every leg's bypass prints. */
  const errors = (): string[] =>
    said.filter(each => !HOOK_TRUST_WARNING.test(each));

  /**
   * The leg's end when no turn failed: an error the classifier knows, else
   * Codex's own error lines (it writes them on stdout, not stderr).
   */
  const crashed = (): SessionEnd | null => {
    const known = errors().find(each => classifyProviderError(each) !== null);
    if (known !== undefined) return errorEnd(known);
    return errors().length === 0
      ? null
      : errorEnd(errors().join("\n"), "driver_crashed");
  };

  return {
    decode: line => {
      const message = parseLine(line);
      const type = get(message, "type");
      switch (type) {
        case "thread.started": {
          sessionId = str(get(message, "thread_id"));
          return {
            events: [
              {
                type: "session.started",
                sessionId,
                model: spec.model ?? "default",
                cwd: spec.cwd,
              },
            ],
          };
        }
        case "item.started":
        case "item.completed": {
          return { events: item(type, get(message, "item")) };
        }
        case "turn.completed": {
          usage = addUsage(usage, codexTurnUsage(get(message, "usage")));
          return { events: [], usage };
        }
        case "turn.failed": {
          const words = str(get(get(message, "error"), "message")) || "error";
          saying(words);
          failed ??= errorEnd(words);
          return { events: [] };
        }
        case "error": {
          saying(str(get(message, "message")));
          return { events: [] };
        }
        default: {
          return { events: [] };
        }
      }
    },
    exit: code => {
      const interrupted = code === INTERRUPTED;
      const end = interrupted
        ? endFor("interrupted", {}, errors().join("\n"))
        : (failed ?? (code === 0 ? endFor("no_report") : crashed()));
      // A failure no line explains is explained from stderr instead.
      if (end === null) return [];
      const ok = code === 0 && failed === null;
      return [
        {
          type: "session.finished",
          outcome: {
            subtype: ok ? "success" : "error_during_execution",
            end,
            sessionId,
            report: null,
            text,
            usage: { ...usage, durationMs: Date.now() - began },
            errors: ok ? [] : errors(),
          },
        },
      ];
    },
    toolsRan: () => ranTools,
  };
};
