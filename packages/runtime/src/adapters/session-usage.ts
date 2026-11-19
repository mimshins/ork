/**
 * @file Usage arithmetic the drivers' decoders share: a model request's prompt,
 *   a session's context (`contextTokens`), and two legs of one session added up
 *   as one (specs/runtime/session-ends.md, "The token cap").
 */

import type { SessionUsage } from "@krapht/ork-core";

/** A model request's prompt: input + cache read + cache write. */
export const promptOf = (usage: SessionUsage): number =>
  usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;

/** `usage` with `contextTokens`, when there is one. */
export const withContext = (
  usage: SessionUsage,
  context: number | undefined,
): SessionUsage =>
  context === undefined ? usage : { ...usage, contextTokens: context };

/**
 * Two legs of one session, as one: the tokens of both, the later leg's cost,
 * which is already the session's total (ADR-046), and the later leg's context.
 */
export const addUsage = (a: SessionUsage, b: SessionUsage): SessionUsage =>
  withContext(
    {
      costUsd: Math.max(a.costUsd, b.costUsd),
      inputTokens: a.inputTokens + b.inputTokens,
      outputTokens: a.outputTokens + b.outputTokens,
      cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
      cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
      turns: a.turns + b.turns,
      durationMs: a.durationMs + b.durationMs,
    },
    b.contextTokens ?? a.contextTokens,
  );
