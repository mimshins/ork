/**
 * @file Triage by rules (ADR-059): items about the same problem, the same
 *   target and kind with normalized titles that share at least 80% of their
 *   words, are proposed as one, under the item seen first. No model runs. Only
 *   unsettled items take part (`new` or `triaged`), and a group is proposed
 *   only when it holds a `new` one, so a merge someone declined isn't asked
 *   again until something new joins it.
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

/** One kind of item's groups: each pair near enough joins their groups. */
const groupsOf = (items: readonly FeedbackItem[]): FeedbackItem[][] => {
  const parent = items.map((_, index) => index);
  const find = (index: number): number => {
    let at = index;
    while (parent[at] !== at) at = parent[at] ?? at;
    return at;
  };
  for (const [i, a] of items.entries()) {
    for (const [j, b] of items.entries()) {
      if (j > i && titleOverlap(a.title, b.title) >= NEAR_DUPLICATE) {
        parent[find(j)] = find(i);
      }
    }
  }
  const groups = new Map<number, FeedbackItem[]>();
  for (const [index, item] of items.entries()) {
    const root = find(index);
    groups.set(root, [...(groups.get(root) ?? []), item]);
  }
  return [...groups.values()];
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
      const [into, ...from] = group.toSorted(firstSeen);
      return into === undefined ? undefined : { into, from };
    })
    .filter(merge => merge !== undefined)
    .toSorted((a, b) => firstSeen(a.into, b.into));
};
