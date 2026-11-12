/**
 * @file What a session spent, from what it reported (ADR-046). Claude Code
 *   reports a resumed session's cost as its total so far, carried over from its
 *   transcript when that has one, and a crash's result may carry zero. The
 *   ledger and the scheduler both read a session's reports through `ownSpend`;
 *   `earlierSpend` is what a resumed run starts from.
 */

import { AGENT_DRIVERS } from "@krapht/ork-integrations";

import type { RunEvent } from "../run/types.ts";
import type { SessionUsage } from "../runtime/outcome.ts";

/**
 * The tokens a token budget or quota counts (RFC-015): input, output and cache
 * writes. Cache reads never count. The ledger's `tokensSince` sums the same.
 */
export const countedTokens = (
  usage: Pick<
    SessionUsage,
    "inputTokens" | "outputTokens" | "cacheWriteTokens"
  >,
): number => usage.inputTokens + usage.outputTokens + usage.cacheWriteTokens;

/** The drivers that report no dollars: a dollar total can't see their sessions. */
export const UNPRICED_DRIVERS: readonly string[] = AGENT_DRIVERS.filter(
  driver => !driver.capabilities.price,
).map(driver => driver.id);

/** Whether a session on `driver` spends dollars no total can see. */
export const unpriced = (driver: string | undefined): boolean =>
  driver !== undefined && UNPRICED_DRIVERS.includes(driver);

/** What a report would add to the session's earlier ones, counting nothing. */
export const unreported = (
  reported: ReadonlyMap<string, number>,
  key: string,
  total: number,
): number => {
  if (total <= 0) return 0;
  const before = reported.get(key) ?? 0;
  return total < before ? total : total - before;
};

/**
 * What a report adds to the session's earlier ones, keeping the total in
 * `reported`. A zero says nothing, so it is ignored; a lower total is a session
 * that started counting again, so all of it is new.
 */
export const ownSpend = (
  reported: Map<string, number>,
  key: string,
  total: number,
): number => {
  const own = unreported(reported, key, total);
  if (total > 0) reported.set(key, total);
  return own;
};

/**
 * What a run has spent so far, each session's last total, and what each
 * leader's forks spent (ADR-063), which no `node.finished` carries.
 */
export type EarlierSpend = {
  total: number;
  /** The counted tokens its nodes and forks recorded. */
  tokens?: number;
  /** A session ran on a driver that reports no dollars (RFC-015). */
  partial?: boolean;
  reported: ReadonlyMap<string, number>;
  forks?: ReadonlyMap<string, number>;
};

/**
 * What a run's events say it spent, for `ork resume`. The total is what its
 * nodes recorded. A session's report counts once its node finished, or when
 * `ork chat` made it outside any node: a session cut off before its node
 * finished has recorded nothing, so its next total counts the part that was cut
 * off. A leader's fork is never resumed, so its report counts when it comes,
 * whether or not its leader finished.
 */
export const earlierSpend = (events: Iterable<RunEvent>): EarlierSpend => {
  const reported = new Map<string, number>();
  const open = new Map<string, { key: string; cost: number } | null>();
  const forks = new Map<string, number>();
  let total = 0;
  let tokens = 0;
  let partial = false;
  for (const event of events) {
    if (event.type === "node.started") {
      open.set(event.id, null);
    } else if (event.type === "node.finished") {
      total += event.usage?.costUsd ?? 0;
      tokens += event.usage === undefined ? 0 : countedTokens(event.usage);
      const last = open.get(event.id);
      if (last !== null && last !== undefined) {
        ownSpend(reported, last.key, last.cost);
      }
      open.delete(event.id);
    } else if (
      event.type === "node.event" &&
      event.event.type === "session.started"
    ) {
      partial ||= unpriced(event.event.driver);
    } else if (
      event.type === "node.event" &&
      event.event.type === "session.finished"
    ) {
      const { sessionId, usage } = event.event.outcome;
      const key = `${event.id}/${sessionId}`;
      if (event.event.fork === true) {
        const own = ownSpend(reported, key, usage.costUsd);
        total += own;
        tokens += countedTokens(usage);
        forks.set(event.id, (forks.get(event.id) ?? 0) + own);
      } else if (open.has(event.id)) {
        open.set(event.id, { key, cost: usage.costUsd });
      } else ownSpend(reported, key, usage.costUsd);
    }
  }
  return { total, tokens, partial, reported, forks };
};
