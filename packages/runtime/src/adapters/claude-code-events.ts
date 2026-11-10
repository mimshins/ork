/**
 * @file The `claude-code` adapter's `EventDecoder` and `UsageReader`: maps the
 *   `claude` CLI's `stream-json` lines to Ork's runtime events, marks the
 *   result of a turn the hold hook deferred, and adds up a session's legs.
 */

import {
  parseReport,
  type RuntimeEvent,
  type SessionOutcome,
  type SessionUsage,
} from "@krapht/ork-core";

import type { Decoded, UsageReader } from "../adapter.ts";

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const get = (value: unknown, key: string): unknown =>
  isObject(value) ? value[key] : undefined;

const num = (value: unknown): number => (typeof value === "number" ? value : 0);

const str = (value: unknown): string =>
  typeof value === "string" ? value : "";

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

/** The outcome a `result` message describes. */
export const outcomeOf = (result: Json): SessionOutcome => {
  const errors = result["errors"];
  return {
    subtype: str(result["subtype"]) || "unknown",
    sessionId: str(result["session_id"]),
    report: parseReport(result["structured_output"]),
    text: str(result["result"]),
    usage: usageOf(result),
    errors: Array.isArray(errors)
      ? errors.filter(e => typeof e === "string")
      : [],
  };
};

/** The year 2286: a reset beyond this is not in seconds. */
const MAX_RESET_SECONDS = 1e10;

/**
 * What a subscription's limit said (RFC-007). Only the fields Claude Code
 * documents are read, so `utilization`, often absent, plays no part.
 */
const planLimitOf = (info: unknown): RuntimeEvent[] => {
  const status = get(info, "status");
  if (
    status !== "allowed" &&
    status !== "allowed_warning" &&
    status !== "rejected"
  ) {
    return [];
  }
  const window = get(info, "rateLimitType");
  const resets = get(info, "resetsAt");
  const overage = get(info, "overageStatus");
  // A plan with extra usage to draw on goes on past its own limit.
  const refused =
    status === "rejected" &&
    overage !== "allowed" &&
    overage !== "allowed_warning";
  return [
    {
      type: "plan.limit",
      status: status === "rejected" && !refused ? "allowed_warning" : status,
      window: typeof window === "string" ? window : "plan",
      // In seconds: anything else would hold every run for ever.
      ...(typeof resets === "number" && resets > 0 && resets < MAX_RESET_SECONDS
        ? { resetsAt: new Date(resets * 1000).toISOString() }
        : {}),
    },
  ];
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
        .map(block => ({
          type: "tool.result",
          id: str(block["tool_use_id"]),
          isError: block["is_error"] === true,
        }));
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

/**
 * Two legs of one session, as one: the tokens of both, and the later leg's
 * cost, which is already the session's total (ADR-046).
 */
export const addUsage = (a: SessionUsage, b: SessionUsage): SessionUsage => ({
  costUsd: Math.max(a.costUsd, b.costUsd),
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  turns: a.turns + b.turns,
  durationMs: a.durationMs + b.durationMs,
});

/** `claude` reports dollars (a client-side estimate) and tokens. */
export const claudeUsage: UsageReader = { dollars: true, combine: addUsage };
