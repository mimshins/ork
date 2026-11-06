/**
 * @file `ork feedback triage` (ADR-059): the merges Ork's rules propose among
 *   unsettled items, each made only when the person says yes, then every new
 *   item marked `triaged`, so a declined merge isn't asked again until a new
 *   item joins it. `ork feedback split` takes a merge apart.
 */

import {
  type EventStore,
  type FeedbackItem,
  proposeMerges,
  type ProposedMerge,
} from "@krapht/ork-core";

const lineOf = (item: FeedbackItem): string =>
  `${item.id.slice(0, 12)} ${`${String(item.count)}×`.padStart(4)}  ${item.title}`;

/** A proposed merge as the person reads it before saying yes. */
export const formatMerge = (merge: ProposedMerge): string[] => [
  `Merge into ${lineOf(merge.into)}`,
  ...merge.from.map(item => `      ${lineOf(item)}`),
];

export type Triaged = {
  /** Items merged into another. */
  merged: number;
  /** Merges proposed and declined. */
  declined: number;
  /** New items now `triaged`. */
  triaged: number;
};

/**
 * Proposes each merge, makes those `ask` says yes to, and marks every item that
 * was new `triaged`.
 */
export const triage = async (
  store: EventStore,
  ask: (merge: ProposedMerge) => Promise<boolean>,
): Promise<Triaged> => {
  const items = store.feedbackItems();
  const fresh = items.filter(item => item.status === "new");
  let merged = 0;
  let declined = 0;
  for (const merge of proposeMerges(items)) {
    // oxlint-disable-next-line no-await-in-loop -- one question at a time
    if (await ask(merge)) {
      merged += store.mergeFeedback(
        merge.into.id,
        merge.from.map(item => item.id),
      );
    } else {
      declined += 1;
    }
  }
  for (const item of fresh) store.setFeedbackStatus(item.id, "triaged");
  return { merged, declined, triaged: fresh.length };
};

/** What triage did, in a line. */
export const triageSummary = ({
  merged,
  declined,
  triaged,
}: Triaged): string => {
  const parts = [
    merged === 0 ? "nothing merged" : `merged ${String(merged)} item(s)`,
    ...(declined === 0 ? [] : [`${String(declined)} merge(s) declined`]),
    `${String(triaged)} new item(s) triaged`,
  ];
  return parts.join("; ");
};
