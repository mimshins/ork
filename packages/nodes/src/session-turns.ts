/**
 * @file One session over several processes: the outcome after another turn, and
 *   what that turn may spend. Late messages and failed checks both resume a
 *   session that has finished, and neither is free.
 */

import {
  endedWith,
  endFor,
  type EndKind,
  type ExecuteContext,
  failedWith,
  type NodeResult,
  outcomeEnd,
  planReason,
  type RuntimeEvent,
  type SessionOutcome,
  type SessionSpec,
  type SessionUsage,
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
  if (later.report !== null) return merged;
  const { end: _later, ...rest } = merged;
  return {
    ...rest,
    report: first.report,
    subtype: first.subtype,
    ...(first.end === undefined ? {} : { end: first.end }),
    text: first.text,
    errors: first.errors,
  };
};

export type TurnLimits = {
  budgetUsd?: number;
  budgetTokens?: number;
  maxTurns?: number;
};

/** The least of the limits that are set; `undefined` with none. */
export const least = (
  ...limits: (number | undefined)[]
): number | undefined => {
  const known = limits.filter(limit => limit !== undefined);
  return known.length === 0 ? undefined : Math.min(...known);
};

/** A cap less what this activation used, beside what a quota says is left. */
const leftOf = (
  caps: (number | undefined)[],
  used: number,
  quotaLeft: number | undefined,
): number | undefined =>
  least(
    ...caps.map(cap => (cap === undefined ? undefined : cap - used)),
    quotaLeft,
  );

/**
 * The turns a failed check's resume gets at least, even past the node's
 * `maxTurns`: a session that used its turns finding the fix still gets to make
 * the check pass. Dollars and tokens stay capped; `verify.attempts` bounds how
 * often.
 */
export const CHECK_RETRY_TURNS = 20;

/**
 * What another turn of a session may use. `spent`, `tokens` (counted, RFC-015)
 * and `turns` are this activation's, which neither the node's cap nor the run's
 * budget has counted. The quota has: the ledger took it as the session
 * finished, so what it says is left is left. The run's tokens left have too:
 * only the node's own `budgetTokens` takes `tokens` off. `null` when nothing
 * is, and the turn does not start. `turnsAtLeast` lifts the turns left to that
 * many (a failed check's resume: `CHECK_RETRY_TURNS`).
 */
export const lateLimits = (
  spec: Pick<SessionSpec, "budgetUsd" | "budgetTokens" | "maxTurns">,
  used: { spent: number; turns: number; tokens?: number },
  runLeft?: number,
  quotaLeft?: number,
  tokensLeft: { run?: number | undefined; quota?: number | undefined } = {},
  turnsAtLeast = 0,
): TurnLimits | null => {
  const budgetUsd = leftOf([spec.budgetUsd, runLeft], used.spent, quotaLeft);
  // The run's tokens left already count this activation's (its sessions
  // reported them as they finished), as a quota's do.
  const budgetTokens = leftOf(
    [spec.budgetTokens],
    used.tokens ?? 0,
    least(tokensLeft.run, tokensLeft.quota),
  );
  const maxTurns =
    spec.maxTurns === undefined
      ? undefined
      : Math.max(spec.maxTurns - used.turns, turnsAtLeast);
  if ([budgetUsd, budgetTokens, maxTurns].some(left => (left ?? 1) <= 0)) {
    return null;
  }
  return {
    ...(budgetUsd === undefined ? {} : { budgetUsd }),
    ...(budgetTokens === undefined ? {} : { budgetTokens }),
    ...(maxTurns === undefined ? {} : { maxTurns }),
  };
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
    session: (asked: Pick<SessionSpec, "budgetUsd" | "budgetTokens">) => {
      const { leftUsd: left, leftTokens } = context.quota?.() ?? {};
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
            (left !== undefined &&
              asked.budgetUsd !== undefined &&
              asked.budgetUsd >= left) ||
            (leftTokens !== undefined &&
              asked.budgetTokens !== undefined &&
              asked.budgetTokens >= leftTokens);
          const spent =
            outcome !== null && outcomeEnd(outcome).kind === "budget_limit";
          if (capped && spent) {
            why =
              context.quota?.().blocked ??
              "a session reached what was left of a quota";
          }
        },
      };
    },
    // A limit across runs comes before what the session itself saw; a plan
    // limit only the session's words said stops the run too (RFC-007).
    result: (result: NodeResult): NodeResult => {
      if (result.ok) return result;
      if (why !== undefined) {
        return {
          ...endedWith(result, endFor("plan_limit", {}, why)),
          limited: why,
        };
      }
      const { end } = result;
      return end?.kind === "plan_limit"
        ? { ...result, limited: end.message }
        : result;
    },
  };
};

/**
 * No session started: nothing was left for one, or nothing to start it. Its
 * summary keeps Ork's reason, `end.detail` too; the message is the kind's.
 */
export const notStarted = (
  kind: EndKind,
  reason: string,
  limited?: string,
): NodeResult => ({
  // Only `tool_missing` reads `program`: a Claude node's program is its driver.
  ...failedWith(endFor(kind, { reason, program: "an agent driver" }, reason), {
    status: "fail",
    summary: `not started: ${reason}`,
  }),
  ...(limited === undefined ? {} : { limited }),
});
