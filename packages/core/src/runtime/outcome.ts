/**
 * @file What a finished session hands back through the runtime port: its usage,
 *   its report, and how it ended (specs/runtime/session-ends.md).
 */

import type { SessionEnd } from "./ends.ts";
import type { NodeReport } from "./types.ts";

export type SessionUsage = {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  turns: number;
  durationMs: number;
  /**
   * The prompt of the session's last model request: input + cache read + cache
   * write (the "prompt" figure of specs/usage/tokens.md). Unset when the driver
   * gives no per-request usage. Two legs of one session keep the later leg's.
   */
  contextTokens?: number;
};

export type SessionOutcome = {
  /**
   * `success`, or the driver's error subtype (e.g. `error_max_turns`). Kept one
   * release for stored events; decide by `end`, through `outcomeEnd`.
   */
  subtype: string;
  /**
   * How the session ended (specs/runtime/session-ends.md). Optional until every
   * driver's decoder sets it; `outcomeEnd` reads one from `subtype` when it is
   * unset.
   */
  end?: SessionEnd;
  sessionId: string;
  /** `null` when the session ended without a valid report. */
  report: NodeReport | null;
  /** The final assistant text. */
  text: string;
  usage: SessionUsage;
  errors: string[];
};
