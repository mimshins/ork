/**
 * @file What a run has spent: each result counted for only what its activation
 *   spent, what running sessions last reported, and what that leaves of the
 *   run's budget and any quota, in dollars and in counted tokens (RFC-015).
 */

import type { SessionUsage } from "../runtime/outcome.ts";
import type { RunLimits } from "../usage/quota.ts";
import {
  countedTokens,
  type EarlierSpend,
  ownSpend,
  unpriced,
  unreported,
} from "../usage/spend.ts";
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

const sum = (values: Iterable<number>): number =>
  [...values].reduce((total, value) => total + value, 0);

/** The least of the limits that are set; `undefined` with none. */
const least = (...limits: (number | undefined)[]): number | undefined => {
  const known = limits.filter(limit => limit !== undefined);
  return known.length === 0 ? undefined : Math.min(...known);
};

/**
 * A run's spending so far; a resumed run starts from what it had spent.
 * `budgetTokens` caps its counted tokens as `budgetUsd` caps its dollars.
 */
export const createSpend = (
  budgetUsd: number | undefined,
  earlier?: EarlierSpend,
  limits?: () => RunLimits,
  budgetTokens?: number,
) => {
  const reported = new Map(earlier?.reported);
  let spent = earlier?.total ?? 0;
  let tokens = earlier?.tokens ?? 0;
  let partial = earlier?.partial ?? false;
  /** What running sessions last reported, not yet in `spent`, by `node/session`. */
  const inFlight = new Map<string, number>();
  /** Their counted tokens: each process's own, so a session's add up. */
  const tokensInFlight = new Map<string, number>();
  const committed = () => spent + sum(inFlight.values());
  const committedTokens = () => tokens + sum(tokensInFlight.values());
  /** Caps running sessions were given (ADR-077): out of what is offered. */
  const reserves = createReserves();
  const budgetLeft = () =>
    budgetUsd === undefined
      ? undefined
      : budgetUsd - committed() - reserves.total();
  const tokensLeft = () =>
    budgetTokens === undefined
      ? undefined
      : budgetTokens - committedTokens() - reserves.total("tokens");
  /**
   * A running session said what it has spent so far, and the counted tokens of
   * the process that just ended.
   */
  const report = (
    id: string,
    sessionId: string,
    total: number,
    counted = 0,
  ): void => {
    const key = `${id}/${sessionId}`;
    inFlight.set(key, unreported(reported, key, total));
    tokensInFlight.set(key, (tokensInFlight.get(key) ?? 0) + counted);
  };
  return {
    total: () => spent,
    /** The counted tokens of what `total` counts. */
    tokens: () => tokens,
    /** A session ran on a driver that reports no dollars: `total` is partial. */
    partial: () => partial,
    /** What the run's result says it spent. */
    sums: () => ({ costUsd: spent, tokens, partial }),
    /** A session ran on `driver`. */
    started: (driver: string | undefined): void => {
      partial ||= unpriced(driver);
    },
    /** A node sets aside its session's cap; nothing or 0 lets it go. */
    reserve: reserves.reserve,
    /** A session finished with `usage`: `report` with its counted tokens. */
    reported: (id: string, sessionId: string, usage: SessionUsage): void => {
      report(id, sessionId, usage.costUsd, countedTokens(usage));
    },
    /** Waits until another node's reserve frees; `false` when none can. */
    freed: reserves.freed,
    /** What a session has spent in this activation, from its total so far. */
    ownOf: (id: string, sessionId: string, total: number): number =>
      unreported(reported, `${id}/${sessionId}`, total),
    report,
    /** The node ended: `count` has what its sessions last reported. */
    settled: (id: string): void => {
      for (const map of [inFlight, tokensInFlight]) {
        for (const key of map.keys()) {
          if (key.startsWith(`${id}/`)) map.delete(key);
        }
      }
      reserves.drop(id);
    },
    /** What a session may spend: the least of the budget and any quota. */
    left: () => least(budgetLeft(), limits?.().leftUsd),
    budgetLeft,
    /** What is left of the run's `budgetTokens`, its reserves out. */
    tokensLeft,
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
      if (budgetUsd !== undefined && committed() >= budgetUsd) {
        return {
          status: "budget_exhausted",
          reason: `the run's budget of $${String(budgetUsd)} is spent`,
        };
      }
      return budgetTokens !== undefined && committedTokens() >= budgetTokens
        ? {
            status: "budget_exhausted",
            reason: `the run's budget of ${String(budgetTokens)} tokens is spent`,
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
      tokens += own.usage === undefined ? 0 : countedTokens(own.usage);
      return own;
    },
  };
};

/** A run's spending, from what the scheduler is given. */
export const spendOf = (
  budgetUsd: number | undefined,
  options: Pick<RunOptions, "replay" | "limits">,
  budgetTokens?: number,
) =>
  createSpend(budgetUsd, options.replay?.earlier, options.limits, budgetTokens);
