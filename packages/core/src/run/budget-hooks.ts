/**
 * @file What a node's context says of the run's budget and quotas: what is
 *   left, the reserves a node sets aside for its session (ADR-077), and whether
 *   the run is spent. Part of `ExecuteContext`.
 */

import type { RunLimits } from "../usage/quota.ts";

export type BudgetHooks = {
  /** What is left of `limits.budgetUsd`, when the run has one. */
  budgetLeftUsd: number | undefined;
  /** What is left of the run's own budget now, with what others have spent. */
  budgetLeftNow?: () => number | undefined;
  /** Sets aside its session's cap from the run's budget; 0 lets it go. */
  reserveBudget?: (usd: number | undefined) => void;
  /** What is left of the run's `limits.budgetTokens` now (RFC-015). */
  tokensLeftNow?: () => number | undefined;
  /** Sets aside its session's token cap from the run's; 0 lets it go. */
  reserveTokens?: (tokens: number | undefined) => void;
  /** Waits until another node's reserve frees; `false` when none can. */
  budgetFreed?: (signal: AbortSignal) => Promise<boolean>;
  /**
   * The run's budget in `unit` is spent, reserves not counted: only then may a
   * session cut off at its cap blame the run. Absent: blame by the cap alone.
   */
  budgetSpentIn?: (unit: "usd" | "tokens") => boolean;
  /** What the limits across runs allow now. */
  quota?: () => RunLimits;
  /** What a session has spent in this activation, from its reported total. */
  ownSpend?: (sessionId: string, total: number) => number;
};
