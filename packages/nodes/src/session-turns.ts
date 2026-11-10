/**
 * @file One session over several processes: the outcome after another turn, and
 *   what that turn may spend. Late messages and failed checks both resume a
 *   session that has finished, and neither is free.
 */

import {
  type ExecuteContext,
  type NodeResult,
  planReason,
  type RuntimeEvent,
  type SessionOutcome,
  type SessionSpec,
  type SessionUsage,
} from "@krapht/ork-core";
import { isClaudeNode } from "@krapht/ork-schema";

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
 * What another turn of a session may use. `spent` and `turns` are this
 * activation's, which neither the node's cap nor the run's budget has counted.
 * The quota has: the ledger took it as the session finished, so what it says is
 * left is left. `null` when nothing is, and the turn does not start.
 */
export const lateLimits = (
  spec: Pick<SessionSpec, "budgetUsd" | "maxTurns">,
  { spent, turns }: { spent: number; turns: number },
  runLeft?: number,
  quotaLeft?: number,
): TurnLimits | null => {
  const budgets = [
    ...[spec.budgetUsd, runLeft].flatMap(limit =>
      limit === undefined ? [] : [limit - spent],
    ),
    ...(quotaLeft === undefined ? [] : [quotaLeft]),
  ];
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

/** What a session may spend as it starts: the least of the budget and any quota. */
export const budgetNow = (
  context: Pick<ExecuteContext, "budgetLeftUsd" | "budgetLeftNow" | "quota">,
): number | undefined => {
  if (context.budgetLeftNow === undefined) return context.budgetLeftUsd;
  const known = [context.budgetLeftNow(), context.quota?.().leftUsd].flatMap(
    left => (left === undefined ? [] : [left]),
  );
  return known.length === 0 ? undefined : Math.min(...known);
};

type StartContext = Pick<
  ExecuteContext,
  | "budgetLeftUsd"
  | "budgetLeftNow"
  | "quota"
  | "budgetFreed"
  | "reserveBudget"
  | "node"
  | "workflow"
  | "signal"
>;

/**
 * What a node's first session may spend, set aside from the run's budget in the
 * same step that reads it (ADR-077), so a node starting beside it is never
 * offered the same part: the least of what is left and the node's own
 * `budgetUsd`. With nothing left, it waits for a worker running beside it to
 * finish, as long as one may.
 */
export const budgetToStart = async (
  context: StartContext,
): Promise<number | undefined> => {
  const left = budgetNow(context);
  if (left !== undefined && left <= 0) {
    const freed = await context.budgetFreed?.(context.signal);
    return freed === true ? budgetToStart(context) : left;
  }
  const own = isClaudeNode(context.node)
    ? (context.node.budgetUsd ?? context.workflow.defaults?.budgetUsd)
    : undefined;
  context.reserveBudget?.(
    own === undefined || left === undefined ? left : Math.min(own, left),
  );
  return left;
};

/**
 * Whether a limit across runs, rather than the node's work, ended a node: a
 * session whose cap was a quota's and that ran into it, or one its plan refused
 * and that gave no report. A node that still succeeded is left alone.
 */
export const limitWatch = (context: Pick<ExecuteContext, "quota">) => {
  let why: string | undefined;
  return {
    stoppedBy: (reason: string): void => {
      why = reason;
    },
    session: (asked: Pick<SessionSpec, "budgetUsd">) => {
      const left = context.quota?.().leftUsd;
      let refused: string | undefined;
      return {
        saw: (event: RuntimeEvent): void => {
          if (event.type === "plan.limit" && event.status === "rejected") {
            refused = planReason(event);
          }
        },
        ended: (outcome: SessionOutcome | null): void => {
          if (refused !== undefined && (outcome?.report ?? null) === null) {
            why = refused;
          }
          const capped =
            left !== undefined &&
            asked.budgetUsd !== undefined &&
            asked.budgetUsd >= left;
          if (capped && outcome?.subtype === "error_max_budget_usd") {
            why =
              context.quota?.().blocked ??
              "a session reached what was left of a quota";
          }
        },
      };
    },
    result: (result: NodeResult): NodeResult =>
      result.ok || why === undefined ? result : { ...result, limited: why },
  };
};

/** No session started: nothing was left for one. */
export const notStarted = (reason: string, limited?: string): NodeResult => ({
  ok: false,
  error: `not started: ${reason}`,
  output: { status: "fail", summary: `not started: ${reason}` },
  ...(limited === undefined ? {} : { limited }),
});
