/**
 * @file What a node's first session may spend as it starts, in dollars and in
 *   counted tokens (RFC-015): read from the run's budgets and any quota, and
 *   set aside in the same step (ADR-077). A node with nothing left holds no
 *   reserve while it waits for a worker's to free.
 */

import type { ExecuteContext, NodeResult, PlanOptions } from "@krapht/ork-core";
import { isClaudeNode } from "@krapht/ork-schema";

import { least, notStarted, type RunCaps } from "./session-turns.ts";

/** What a session may spend as it starts: the least of the budget and any quota. */
export const budgetNow = (
  context: Pick<ExecuteContext, "budgetLeftUsd" | "budgetLeftNow" | "quota">,
): number | undefined =>
  context.budgetLeftNow === undefined
    ? context.budgetLeftUsd
    : least(context.budgetLeftNow(), context.quota?.().leftUsd);

/** The counted tokens a session may use as it starts: the run's and a quota's. */
export const tokensNow = (
  context: Pick<ExecuteContext, "tokensLeftNow" | "quota">,
): number | undefined =>
  least(context.tokensLeftNow?.(), context.quota?.().leftTokens);

type StartContext = Pick<
  ExecuteContext,
  | "budgetLeftUsd"
  | "budgetLeftNow"
  | "tokensLeftNow"
  | "quota"
  | "budgetFreed"
  | "reserveBudget"
  | "reserveTokens"
  | "node"
  | "workflow"
  | "signal"
>;

/**
 * What is `left` now, with `own` (the node's cap) set aside through `reserve`
 * in the same step; with nothing left, it waits for a worker's reserve to
 * free.
 */
const startWith = async (
  context: StartContext,
  left: () => number | undefined,
  own: number | undefined,
  reserve: ((amount: number | undefined) => void) | undefined,
): Promise<number | undefined> => {
  const now = left();
  if (now !== undefined && now <= 0) {
    // Hold nothing while waiting: a node waiting on this one would wait for ever.
    context.reserveBudget?.(0);
    context.reserveTokens?.(0);
    const freed = await context.budgetFreed?.(context.signal);
    return freed === true ? startWith(context, left, own, reserve) : now;
  }
  reserve?.(own === undefined || now === undefined ? now : Math.min(own, now));
  return now;
};

/**
 * What a node's first session may spend, set aside from the run's budget in the
 * same step that reads it (ADR-077), so a node starting beside it is never
 * offered the same part: the least of what is left and the node's own
 * `budgetUsd`. With nothing left, it waits for a worker running beside it to
 * finish, as long as one may.
 */
export const budgetToStart = (
  context: StartContext,
): Promise<number | undefined> =>
  startWith(
    context,
    () => budgetNow(context),
    ownCaps(context).usd,
    context.reserveBudget,
  );

/** The node's own caps: its `budgetUsd` and `budgetTokens`, else the defaults'. */
const ownCaps = (
  context: Pick<StartContext, "node" | "workflow">,
): { usd?: number | undefined; tokens?: number | undefined } =>
  isClaudeNode(context.node)
    ? {
        usd: context.node.budgetUsd ?? context.workflow.defaults?.budgetUsd,
        tokens:
          context.node.budgetTokens ?? context.workflow.defaults?.budgetTokens,
      }
    : {};

/**
 * Where the run's budget, not the node's own cap, caps the node's first
 * session: the run has a budget in that unit, and what `startBudgets` left the
 * session is below the node's own cap, or it has none. A later turn of the
 * session keeps them: both its caps go down by what it used, and the run's by
 * what others used too.
 */
export const runCapsOf = (
  context: StartContext,
  planOptions: Pick<PlanOptions, "budgetLeftUsd" | "budgetLeftTokens">,
): RunCaps => {
  const own = ownCaps(context);
  const limits = context.workflow.limits;
  const caps: RunCaps = {};
  const usd = planOptions.budgetLeftUsd;
  if (
    context.budgetLeftNow?.() !== undefined &&
    limits?.budgetUsd !== undefined &&
    usd !== undefined &&
    usd < (own.usd ?? Infinity)
  ) {
    caps.usd = limits.budgetUsd;
  }
  const tokens = planOptions.budgetLeftTokens;
  if (
    context.tokensLeftNow?.() !== undefined &&
    limits?.budgetTokens !== undefined &&
    tokens !== undefined &&
    tokens < (own.tokens ?? Infinity)
  ) {
    caps.tokens = limits.budgetTokens;
  }
  return caps;
};

/** `budgetToStart` in counted tokens: the run's `budgetTokens` and a quota's. */
export const tokensToStart = (
  context: StartContext,
): Promise<number | undefined> =>
  startWith(
    context,
    () => tokensNow(context),
    ownCaps(context).tokens,
    context.reserveTokens,
  );

/**
 * What a node's first session may spend, in dollars and in counted tokens, set
 * into `planOptions`; the node's result instead when nothing is left of
 * either.
 */
export const startBudgets = async (
  context: StartContext,
  planOptions: Pick<PlanOptions, "budgetLeftUsd" | "budgetLeftTokens">,
): Promise<NodeResult | null> => {
  const usd = await budgetToStart(context);
  if (usd !== undefined && usd <= 0) {
    return notStarted("budget_limit", "nothing is left of the run's budget");
  }
  if (usd !== undefined) planOptions.budgetLeftUsd = usd;
  const waited = { done: false };
  const tokens = await tokensToStart({
    ...context,
    budgetFreed: async signal => {
      waited.done = true;
      return (await context.budgetFreed?.(signal)) ?? false;
    },
  });
  if (tokens !== undefined && tokens <= 0) {
    return notStarted("budget_limit", "nothing is left of the run's tokens");
  }
  // A wait for tokens let the dollars go: read both again, together.
  if (waited.done) {
    context.reserveTokens?.(0);
    return startBudgets(context, planOptions);
  }
  if (tokens !== undefined) planOptions.budgetLeftTokens = tokens;
  return null;
};
