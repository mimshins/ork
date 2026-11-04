/**
 * @file What a session spent, from what it reported (ADR-046). Claude Code
 *   reports a resumed session's cost as its total so far, carried over from its
 *   transcript when that has one, and a crash's result may carry zero. The
 *   ledger and the scheduler both read a session's reports through `ownSpend`;
 *   `earlierSpend` is what a resumed run starts from.
 */

import type { RunEvent } from "../run/types.ts";

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

/** What a run has spent so far, and each session's last total. */
export type EarlierSpend = {
  total: number;
  reported: ReadonlyMap<string, number>;
};

/**
 * What a run's events say it spent, for `ork resume`. The total is what its
 * nodes recorded. A session's report counts once its node finished, or when
 * `ork chat` made it outside any node: a session cut off before its node
 * finished has recorded nothing, so its next total counts the part that was cut
 * off.
 */
export const earlierSpend = (events: Iterable<RunEvent>): EarlierSpend => {
  const reported = new Map<string, number>();
  const open = new Map<string, { key: string; cost: number } | null>();
  let total = 0;
  for (const event of events) {
    if (event.type === "node.started") {
      open.set(event.id, null);
    } else if (event.type === "node.finished") {
      total += event.usage?.costUsd ?? 0;
      const last = open.get(event.id);
      if (last !== null && last !== undefined) {
        ownSpend(reported, last.key, last.cost);
      }
      open.delete(event.id);
    } else if (
      event.type === "node.event" &&
      event.event.type === "session.finished"
    ) {
      const { sessionId, usage } = event.event.outcome;
      const key = `${event.id}/${sessionId}`;
      if (open.has(event.id)) open.set(event.id, { key, cost: usage.costUsd });
      else ownSpend(reported, key, usage.costUsd);
    }
  }
  return { total, reported };
};
