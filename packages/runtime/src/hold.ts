/**
 * @file Holding a session before its next tool call (ADR-041), for every driver
 *   whose tool has a hook before a call: the hook waits while the node is
 *   paused. A pause that outlasts the hold window answers `defer`, which ends
 *   the session's turn with the call still pending; the session runner resumes
 *   the session once the node continues, and the same call's hook then lets it
 *   run. Nothing is cut short.
 */

import type { HoldPort } from "@krapht/ork-core";

export type HoldAnswer = "go" | "defer";

/**
 * Waits at a tool call while `hold` is held: "go" once it is released within
 * the window (or at once when it is not held), "defer" after the window.
 */
export const holdAtTool = async (
  hold: HoldPort,
  signal: AbortSignal,
  windowMs: number,
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
