/**
 * @file Both drivers emit the same message JSON (the Agent SDK's messages are
 *   the CLI's `stream-json` lines), so one normalizer serves both.
 */

import {
  parseReport,
  type RuntimeEvent,
  type SessionOutcome,
  type SessionUsage,
} from "@krapht/ork-core";
import type { Driver } from "@krapht/ork-schema";

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

/** Marks a session's start with the driver that runs it. */
export const withDriver = (
  event: RuntimeEvent,
  driver: Driver,
): RuntimeEvent =>
  event.type === "session.started" ? { ...event, driver } : event;

/** A finished event for a session the driver could not run. */
export const driverFailure = (message: string): RuntimeEvent => ({
  type: "session.finished",
  outcome: {
    subtype: "error_driver",
    sessionId: "",
    report: null,
    text: "",
    usage: {
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      turns: 0,
      durationMs: 0,
    },
    errors: [message],
  },
});
