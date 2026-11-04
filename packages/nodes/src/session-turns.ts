/**
 * @file One session over several processes: the outcome after another turn, and
 *   what that turn may spend. Late messages and failed checks both resume a
 *   session that has finished, and neither is free.
 */

import type {
  SessionOutcome,
  SessionSpec,
  SessionUsage,
} from "@krapht/ork-core";

/**
 * The later outcome, with the tokens of both processes. Its cost is already the
 * session's total: Claude Code carries it across a resume (ADR-046).
 */
export const withUsageOf = (
  first: SessionOutcome,
  later: SessionOutcome,
): SessionOutcome => {
  const sum = (key: keyof SessionUsage) => first.usage[key] + later.usage[key];
  const usage: SessionUsage = {
    costUsd: Math.max(first.usage.costUsd, later.usage.costUsd),
    inputTokens: sum("inputTokens"),
    outputTokens: sum("outputTokens"),
    cacheReadTokens: sum("cacheReadTokens"),
    cacheWriteTokens: sum("cacheWriteTokens"),
    turns: sum("turns"),
    durationMs: sum("durationMs"),
  };
  // A turn that never started has no session; the first one's goes on.
  const sessionId = later.sessionId === "" ? first.sessionId : later.sessionId;
  return { ...later, sessionId, usage };
};

/**
 * The session after a late turn. A turn that gave no report, as when it ran out
 * of budget or was stopped, does not undo the report the node already gave.
 */
export const afterLateTurn = (
  first: SessionOutcome,
  later: SessionOutcome,
): SessionOutcome => {
  const merged = withUsageOf(first, later);
  return later.report === null
    ? {
        ...merged,
        report: first.report,
        subtype: first.subtype,
        text: first.text,
        errors: first.errors,
      }
    : merged;
};

/**
 * What a late turn may spend: what is left of the node's cap, which is per
 * process (ADR-046), and of the run's, which has not counted this session yet.
 * `null` when nothing is left, and the message waits for its next session. A
 * resumed session's cost is its total, so this may leave it less than it has.
 */
export const lateBudget = (
  spec: Pick<SessionSpec, "budgetUsd">,
  spent: number,
  runLeft: number | undefined,
): { budgetUsd?: number } | null => {
  const limits = [spec.budgetUsd, runLeft].flatMap(limit =>
    limit === undefined ? [] : [limit - spent],
  );
  if (limits.length === 0) return {};
  const budgetUsd = Math.min(...limits);
  return budgetUsd > 0 ? { budgetUsd } : null;
};
