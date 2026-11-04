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

export type TurnLimits = { budgetUsd?: number; maxTurns?: number };

/**
 * What another turn of a session may use: what is left of the node's cap and
 * the run's budget, neither of which has counted this activation yet, and of
 * the node's turns, as each process would otherwise count from zero. `spent` is
 * what this activation spent, and `turns` what it took. `null` when nothing is
 * left, and the turn does not start.
 */
export const lateLimits = (
  spec: Pick<SessionSpec, "budgetUsd" | "maxTurns">,
  { spent, turns }: { spent: number; turns: number },
  runLeft?: number,
): TurnLimits | null => {
  const budgets = [spec.budgetUsd, runLeft].flatMap(limit =>
    limit === undefined ? [] : [limit - spent],
  );
  const budgetUsd = budgets.length === 0 ? undefined : Math.min(...budgets);
  if (budgetUsd !== undefined && budgetUsd <= 0) return null;
  const maxTurns =
    spec.maxTurns === undefined ? undefined : spec.maxTurns - turns;
  if (maxTurns !== undefined && maxTurns <= 0) return null;
  return {
    ...(budgetUsd === undefined ? {} : { budgetUsd }),
    ...(maxTurns === undefined ? {} : { maxTurns }),
  };
};
