/**
 * @file Holding a session before its next tool call (ADR-041), shared by both
 *   drivers: a `PreToolUse` hook waits while the node is paused. A pause that
 *   outlasts the hold window answers `defer`, which ends the session's turn
 *   with the call still pending; the driver resumes the session once the node
 *   continues, and the same call's hook then lets it run. Nothing is cut
 *   short.
 */

import type { HoldPort, RuntimeEvent, SessionUsage } from "@krapht/ork-core";
import type { Driver } from "@krapht/ork-schema";

import { normalize, withDriver } from "./normalize.ts";

/** Claude Code cancels a hook after this; a held call must answer before. */
export const HOOK_TIMEOUT_S = 600;

/** How long a hook holds a call before it defers it instead. */
export const HOLD_WINDOW_MS = (HOOK_TIMEOUT_S - 60) * 1000;

export type HoldAnswer = "go" | "defer";

/**
 * Waits at a tool call while `hold` is held: "go" once it is released within
 * the window (or at once when it is not held), "defer" after the window.
 */
export const holdAtTool = async (
  hold: HoldPort,
  signal: AbortSignal,
  windowMs = HOLD_WINDOW_MS,
): Promise<HoldAnswer> => {
  if (!hold.held()) return "go";
  const window = new AbortController();
  const timer = setTimeout(() => {
    window.abort();
  }, windowMs);
  try {
    await hold.wait("tool", AbortSignal.any([signal, window.signal]));
  } finally {
    clearTimeout(timer);
  }
  return hold.held() && !signal.aborted ? "defer" : "go";
};

/** The hook's answer: nothing to say for "go", the deferral otherwise. */
export const hookOutput = (answer: HoldAnswer): Record<string, unknown> =>
  answer === "go"
    ? {}
    : {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "defer",
          permissionDecisionReason:
            "Ork paused this node; it goes on from this call when it continues.",
        },
      };

/** Whether a stream-json message is the result of a deferred tool call. */
export const isDeferredResult = (message: unknown): boolean =>
  typeof message === "object" &&
  message !== null &&
  "type" in message &&
  message.type === "result" &&
  "stop_reason" in message &&
  message.stop_reason === "tool_deferred";

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The node's `--settings` with Ork's `PreToolUse` HTTP hook added: before every
 * tool call, pre-approved ones included, the session asks whether its node may
 * go on.
 */
export const withHoldHook = (
  settings: Record<string, unknown> | undefined,
  holdUrl: string,
  token: string,
): Record<string, unknown> => {
  const hooks = isRecord(settings?.["hooks"]) ? settings["hooks"] : {};
  const listed: unknown = hooks["PreToolUse"];
  const before: unknown[] = Array.isArray(listed)
    ? [...(listed as unknown[])]
    : [];
  const hook = {
    type: "http",
    url: holdUrl,
    headers: { Authorization: `Bearer ${token}` },
    timeout: HOOK_TIMEOUT_S,
  };
  return {
    ...settings,
    hooks: {
      ...hooks,
      PreToolUse: [...before, { matcher: "*", hooks: [hook] }],
    },
  };
};

/** How one leg of a session (one process, or one query) ended. */
export type Leg =
  | { kind: "finished" }
  | {
      kind: "deferred";
      sessionId: string;
      usage: SessionUsage;
      /** Its result, yielded only if the session never resumes. */
      last: RuntimeEvent;
    }
  | { kind: "failed"; reason: string };

/**
 * What one stream-json message of a leg yields, and how the leg ends if it
 * does: a result is the session's end, unless the hold hook deferred a call in
 * this leg; a resumed leg's start is not news, and its end carries what the
 * legs before it spent.
 */
export const legStep = (
  message: unknown,
  input: {
    carried: SessionUsage | undefined;
    /** Whether the hold hook deferred a call in this leg. */
    deferred: boolean;
    driver: Driver;
  },
): { events: RuntimeEvent[]; ended?: Leg } => {
  const deferred = input.deferred && isDeferredResult(message);
  const events: RuntimeEvent[] = [];
  let ended: Leg | undefined;
  for (const event of normalize(message)) {
    if (event.type === "session.started" && input.carried !== undefined) {
      continue;
    }
    if (event.type !== "session.finished") {
      events.push(withDriver(event, input.driver));
    } else if (deferred) {
      ended = {
        kind: "deferred",
        sessionId: event.outcome.sessionId,
        usage: event.outcome.usage,
        last: withDriver(event, input.driver),
      };
    } else {
      const usage =
        input.carried === undefined
          ? event.outcome.usage
          : addUsage(input.carried, event.outcome.usage);
      events.push(
        withDriver(
          { ...event, outcome: { ...event.outcome, usage } },
          input.driver,
        ),
      );
      ended = { kind: "finished" };
    }
  }
  return ended === undefined ? { events } : { events, ended };
};
