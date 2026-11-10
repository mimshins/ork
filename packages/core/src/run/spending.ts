/**
 * @file What a run has spent: each result counted for only what its activation
 *   spent, what running sessions last reported, and what that leaves of the
 *   run's budget and any quota.
 */

import type { RunLimits } from "../usage/quota.ts";
import { type EarlierSpend, ownSpend, unreported } from "../usage/spend.ts";
import type { RunOptions } from "./handle.ts";
import { createReserves } from "./reserves.ts";
import type { NodeResult, RunStatus } from "./types.ts";

/**
 * A result with only what this activation spent (ADR-046): a session's report
 * holds its total so far, while its tokens are this process's own. `reported`
 * holds each session's total.
 */
export const withOwnSpend = (
  id: string,
  result: NodeResult,
  reported: Map<string, number>,
): NodeResult => {
  const { sessionId, usage } = result;
  if (sessionId === undefined || usage === undefined) return result;
  const own = {
    ...usage,
    costUsd: ownSpend(reported, `${id}/${sessionId}`, usage.costUsd),
  };
  return {
    ...result,
    usage: own,
    output:
      "usage" in result.output
        ? { ...result.output, usage: own }
        : result.output,
  };
};

/** A run's spending so far; a resumed run starts from what it had spent. */
export const createSpend = (
  budgetUsd: number | undefined,
  earlier?: EarlierSpend,
  limits?: () => RunLimits,
) => {
  const reported = new Map(earlier?.reported);
  let spent = earlier?.total ?? 0;
  /** What running sessions last reported, not yet in `spent`, by `node/session`. */
  const inFlight = new Map<string, number>();
  const committed = () =>
    spent + [...inFlight.values()].reduce((sum, cost) => sum + cost, 0);
  /** Caps running sessions were given (ADR-077): out of what is offered. */
  const reserves = createReserves();
  const budgetLeft = () =>
    budgetUsd === undefined
      ? undefined
      : budgetUsd - committed() - reserves.total();
  return {
    total: () => spent,
    /** A node sets aside its session's cap; nothing or 0 lets it go. */
    reserve: reserves.reserve,
    /** Waits until another node's reserve frees; `false` when none can. */
    freed: reserves.freed,
    /** What a session has spent in this activation, from its total so far. */
    ownOf: (id: string, sessionId: string, total: number): number =>
      unreported(reported, `${id}/${sessionId}`, total),
    /** A running session said what it has spent so far. */
    report: (id: string, sessionId: string, total: number): void => {
      const key = `${id}/${sessionId}`;
      inFlight.set(key, unreported(reported, key, total));
    },
    /** The node ended: `count` has what its sessions last reported. */
    settled: (id: string): void => {
      for (const key of inFlight.keys()) {
        if (key.startsWith(`${id}/`)) inFlight.delete(key);
      }
      reserves.drop(id);
    },
    /** What a session may spend: the least of the budget and any quota. */
    left: () => {
      const known = [budgetLeft(), limits?.().leftUsd].filter(
        left => left !== undefined,
      );
      return known.length === 0 ? undefined : Math.min(...known);
    },
    budgetLeft,
    /** What the limits across runs allow now. */
    quota: (): RunLimits => limits?.() ?? {},
    /**
     * What stops anything new from starting: a quota first, as a budget can be
     * raised.
     */
    spentOut: (): { status: RunStatus; reason: string } | null => {
      const blocked = limits?.().blocked;
      if (blocked !== undefined) {
        return { status: "quota_exhausted", reason: blocked };
      }
      return budgetUsd !== undefined && committed() >= budgetUsd
        ? {
            status: "budget_exhausted",
            reason: `the run's budget of $${String(budgetUsd)} is spent`,
          }
        : null;
    },
    /**
     * Counts a result, and gives it back with only its own spend. A replayed
     * result is as stored, and already in what the run started from.
     */
    count: (id: string, result: NodeResult, replayed: boolean): NodeResult => {
      if (replayed) return result;
      const own = withOwnSpend(id, result, reported);
      spent += own.usage?.costUsd ?? 0;
      return own;
    },
  };
};

/** A run's spending, from what the scheduler is given. */
export const spendOf = (
  budgetUsd: number | undefined,
  options: Pick<RunOptions, "replay" | "limits">,
) => createSpend(budgetUsd, options.replay?.earlier, options.limits);
