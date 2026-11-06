/**
 * @file Triage by rules (ADR-059): items about the same problem, the same
 *   target and kind with normalized titles that share at least 80% of their
 *   words, are proposed as one, under the item seen first. No model runs. Only
 *   unsettled items take part (`new` or `triaged`); each is compared with the
 *   first-seen item of a group, never only with another member, and a group is
 *   proposed only when it holds a `new` one, so a merge someone declined isn't
 *   asked again until something new joins it.
 */

import type { FeedbackItem } from "../store/feedback-types.ts";
import { normalizeTitle } from "./fingerprint.ts";

/** How much of two titles' words must be shared for one problem. */
export const NEAR_DUPLICATE = 0.8;

/** A title's words, as fingerprints compare them. */
export const titleWords = (title: string): Set<string> =>
  new Set(
    normalizeTitle(title)
      .split(" ")
      .filter(word => word !== ""),
  );

/** The share of two titles' words they have in common (Jaccard). */
export const titleOverlap = (a: string, b: string): number => {
  const left = titleWords(a);
  const right = titleWords(b);
  const union = new Set([...left, ...right]);
  if (union.size === 0) return 0;
  const shared = [...left].filter(word => right.has(word)).length;
  return shared / union.size;
};

/** Items the same problem as each other, under the one seen first. */
export type ProposedMerge = { into: FeedbackItem; from: FeedbackItem[] };

const unsettled = (item: FeedbackItem): boolean =>
  item.status === "new" || item.status === "triaged";

const firstSeen = (a: FeedbackItem, b: FeedbackItem): number =>
  a.firstSeen.localeCompare(b.firstSeen) || a.id.localeCompare(b.id);

/**
 * One kind of item's groups, oldest first: an item joins the first group whose
 * first-seen item it is near enough, so every member is within the rule of the
 * item the others go under, never only of one another.
 */
const groupsOf = (items: readonly FeedbackItem[]): FeedbackItem[][] => {
  const groups: FeedbackItem[][] = [];
  for (const item of items.toSorted(firstSeen)) {
    const group = groups.find(
      ([root]) =>
        root !== undefined &&
        titleOverlap(root.title, item.title) >= NEAR_DUPLICATE,
    );
    if (group === undefined) groups.push([item]);
    else group.push(item);
  }
  return groups;
};

/** The merges triage would make among `items`, oldest group first. */
export const proposeMerges = (
  items: readonly FeedbackItem[],
): ProposedMerge[] => {
  const byKind = new Map<string, FeedbackItem[]>();
  for (const item of items.filter(i => unsettled(i))) {
    const key = `${item.target}/${item.kind}`;
    byKind.set(key, [...(byKind.get(key) ?? []), item]);
  }
  return [...byKind.values()]
    .flatMap(sameKind => groupsOf(sameKind))
    .filter(
      group => group.length > 1 && group.some(item => item.status === "new"),
    )
    .map(group => {
      const [into, ...from] = group;
      return into === undefined ? undefined : { into, from };
    })
    .filter(merge => merge !== undefined)
    .toSorted((a, b) => firstSeen(a.into, b.into));
};
