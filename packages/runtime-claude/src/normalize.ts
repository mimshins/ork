import {
  parseReport,
  type RuntimeEvent,
  type SessionOutcome,
  type SessionUsage,
} from "@ork/core";

/**
 * @file Both drivers emit the same message JSON (the Agent SDK's messages are
 *   the CLI's `stream-json` lines), so one normalizer serves both.
 */

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

/** Maps one driver message to zero or more normalized events. */
export const normalize = (message: unknown): RuntimeEvent[] => {
  if (!isObject(message)) return [];
  switch (message["type"]) {
    case "system": {
      return message["subtype"] === "init"
        ? [
            {
              type: "session.started",
              sessionId: str(message["session_id"]),
              model: str(message["model"]),
            },
          ]
        : [];
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
    case "result": {
      return [{ type: "session.finished", outcome: outcomeOf(message) }];
    }
    default: {
      return [];
    }
  }
};

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
