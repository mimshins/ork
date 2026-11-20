/**
 * @file The `claude-code` adapter's `EventDecoder` and `UsageReader`: maps the
 *   `claude` CLI's `stream-json` lines to Ork's runtime events, marks the
 *   result of a turn the hold hook deferred, and adds up a session's legs. Its
 *   leg decoder keeps a report the session handed in and then wrote past.
 */

import {
  type EndKind,
  endFor,
  parseReport,
  type RuntimeEvent,
  type SessionEnd,
  type SessionOutcome,
  type SessionUsage,
} from "@krapht/ork-core";

import type { Decoded, LegDecoder, UsageReader } from "../adapter.ts";
import { errorEnd, sessionEnd } from "../session-end.ts";
import { isBadArguments, orkMessage } from "../tools/tool.ts";
import { planLimitOf } from "./claude-code-limits.ts";
import { addUsage, promptOf, withContext } from "./session-usage.ts";

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const get = (value: unknown, key: string): unknown =>
  isObject(value) ? value[key] : undefined;

const num = (value: unknown): number => (typeof value === "number" ? value : 0);

const str = (value: unknown): string =>
  typeof value === "string" ? value : "";

/**
 * A tool result block. Its text (a string, or its text parts joined) is read
 * only on an error, for an Ork tool's marker: `fault` and `message`.
 */
const toolResult = (block: Json): RuntimeEvent => {
  const isError = block["is_error"] === true;
  const content = isError ? block["content"] : "";
  const body = Array.isArray(content)
    ? content.map(part => str(get(part, "text"))).join("")
    : str(content);
  const said = orkMessage(body);
  return {
    type: "tool.result",
    id: str(block["tool_use_id"]),
    isError,
    ...(isBadArguments(body) ? { fault: "arguments" as const } : {}),
    ...(said === undefined ? {} : { message: said }),
  };
};

const blocks = (message: unknown): Json[] => {
  const content = get(get(message, "message"), "content");
  return Array.isArray(content) ? content.filter(item => isObject(item)) : [];
};

const usageOf = (result: Json): SessionUsage => {
  const usage = get(result, "usage");
  return {
    costUsd: num(result["total_cost_usd"]),
    inputTokens: num(get(usage, "input_tokens")),
    outputTokens: num(get(usage, "output_tokens")),
    cacheReadTokens: num(get(usage, "cache_read_input_tokens")),
    cacheWriteTokens: num(get(usage, "cache_creation_input_tokens")),
    turns: num(result["num_turns"]),
    durationMs: num(result["duration_ms"]),
  };
};

/** Claude Code's error subtypes that name their own kind. */
const SUBTYPE_KINDS: Readonly<Record<string, EndKind>> = {
  error_max_turns: "turn_limit",
  error_max_budget_usd: "budget_limit",
  error_max_structured_output_retries: "invalid_report",
};

/**
 * What a result says went wrong, if anything: a subtype that names its kind, or
 * an error (`is_error`, or an error subtype) read by the provider classifier,
 * `unknown` when it says nothing Ork knows.
 */
const signalOf = (
  subtype: string,
  result: Json,
  errors: readonly string[],
): SessionEnd | null => {
  const text = [...errors, str(result["result"])].join("\n").trim();
  const named = SUBTYPE_KINDS[subtype];
  if (named !== undefined) return endFor(named, {}, text);
  if (subtype === "success" && result["is_error"] !== true) return null;
  return errorEnd(text);
};

/** The outcome a `result` message describes. */
export const outcomeOf = (result: Json): SessionOutcome => {
  const said = result["errors"];
  const errors = Array.isArray(said)
    ? said.filter(e => typeof e === "string")
    : [];
  const subtype = str(result["subtype"]) || "unknown";
  const report = parseReport(result["structured_output"]);
  return {
    subtype,
    end: sessionEnd(signalOf(subtype, result, errors), report),
    sessionId: str(result["session_id"]),
    report,
    text: str(result["result"]),
    usage: usageOf(result),
    errors,
  };
};

/** Maps one driver message to zero or more normalized events. */
export const normalize = (message: unknown): RuntimeEvent[] => {
  if (!isObject(message)) return [];
  switch (message["type"]) {
    case "system": {
      if (message["subtype"] !== "init") return [];
      const started: RuntimeEvent = {
        type: "session.started",
        sessionId: str(message["session_id"]),
        model: str(message["model"]),
      };
      if (str(message["cwd"]) !== "") started.cwd = str(message["cwd"]);
      return [started];
    }
    case "assistant": {
      return blocks(message).flatMap((block): RuntimeEvent[] => {
        if (block["type"] === "text" && str(block["text"]).trim() !== "") {
          return [{ type: "assistant.text", text: str(block["text"]) }];
        }
        if (block["type"] === "tool_use") {
          const input = block["input"];
          return [
            {
              type: "tool.called",
              id: str(block["id"]),
              name: str(block["name"]),
              input: isObject(input) ? input : {},
            },
          ];
        }
        return [];
      });
    }
    case "user": {
      return blocks(message)
        .filter(block => block["type"] === "tool_result")
        .map(block => toolResult(block));
    }
    case "rate_limit_event": {
      return planLimitOf(message["rate_limit_info"]);
    }
    case "result": {
      return [{ type: "session.finished", outcome: outcomeOf(message) }];
    }
    default: {
      return [];
    }
  }
};

/** Whether a stream-json message is the result of a deferred tool call. */
export const isDeferredResult = (message: unknown): boolean =>
  get(message, "type") === "result" &&
  get(message, "stop_reason") === "tool_deferred";

const parseLine = (line: string): unknown => {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return undefined;
  }
};

/** One `stream-json` line, decoded. */
export const decodeClaudeLine = (line: string): Decoded => {
  const message = parseLine(line);
  return { events: normalize(message), deferred: isDeferredResult(message) };
};

/** The tool `claude` hands a `--json-schema` report in with. */
const REPORT_TOOL = "StructuredOutput";

/**
 * A leg's decoder that keeps the last report `claude` accepted (a
 * `StructuredOutput` call whose result was not an error). When the session
 * writes on after it, `claude`'s result can come without `structured_output`;
 * the kept report is then the result's, so a session that reported is not read
 * as one that didn't.
 */
export const claudeDecoder = (): LegDecoder => {
  const calls = new Map<string, unknown>();
  let accepted: unknown;
  /** Each model response's usage, by message id: its blocks repeat it. */
  const responses = new Map<string, SessionUsage>();
  /** The prompt of the last main-thread response (no `parent_tool_use_id`). */
  let context: number | undefined;
  /** The leg's usage so far, when `message` is a model response. */
  const usageSoFar = (message: unknown): SessionUsage | undefined => {
    const inner = get(message, "message");
    const id = get(inner, "id");
    if (get(message, "type") !== "assistant" || typeof id !== "string") {
      return undefined;
    }
    const own = usageOf({ usage: get(inner, "usage") });
    responses.set(id, { ...own, turns: 1 });
    // A sub-agent's request is its own, smaller prompt, not the session's.
    const main = typeof get(message, "parent_tool_use_id") !== "string";
    if (main && isObject(get(inner, "usage"))) {
      context = promptOf(own);
    }
    const sum = [...responses.values()].reduce((a, b) => addUsage(a, b));
    return withContext(sum, context);
  };
  /** An end, with the session's context: `claude`'s result does not give it. */
  const withEndContext = (event: RuntimeEvent): RuntimeEvent =>
    event.type === "session.finished"
      ? {
          ...event,
          outcome: {
            ...event.outcome,
            usage: withContext(event.outcome.usage, context),
          },
        }
      : event;
  return {
    decode: line => {
      const message = parseLine(line);
      const usage = usageSoFar(message);
      for (const block of blocks(message)) {
        if (block["type"] === "tool_use" && block["name"] === REPORT_TOOL) {
          calls.set(str(block["id"]), block["input"]);
        }
        const id = str(block["tool_use_id"]);
        if (block["type"] === "tool_result" && calls.has(id)) {
          if (block["is_error"] !== true) accepted = calls.get(id);
          calls.delete(id);
        }
      }
      const kept =
        isObject(message) &&
        message["type"] === "result" &&
        (message["structured_output"] ?? null) === null &&
        accepted !== undefined
          ? { ...message, structured_output: accepted }
          : message;
      return {
        events: normalize(kept).map(event => withEndContext(event)),
        deferred: isDeferredResult(message),
        ...(usage === undefined ? {} : { usage }),
      };
    },
    exit: () => [],
  };
};

/** `claude` reports dollars (a client-side estimate) and tokens. */
export const claudeUsage: UsageReader = { dollars: true, combine: addUsage };
