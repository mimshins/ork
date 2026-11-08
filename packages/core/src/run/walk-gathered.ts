/**
 * @file The ways a fanned node can end in a walk (RFC-013): one node with
 *   gathered outcomes, never an activation per item, so a long list costs a
 *   walk nothing. All items succeed, or one fails, and for a `from:` list also
 *   an empty list and a list over `maxItems` with each answer. `statuses` and
 *   `count` then vary by what conditions read.
 */

import type { ForEach, Node } from "@krapht/ork-schema";

import { itemSays } from "../graph/says.ts";
import type { Outcome } from "./walk-outcomes.ts";
import { withValues } from "./walk-reads.ts";

const MOST_OUTCOMES = 32;

/** A longer list has mixes of failures a walk doesn't try. */
const TRIED_COMPLETELY = 2;

/** Longer lists are walked as this many entries, with their true `count`. */
const MOST_ENTRIES = 64;

const CONSTANT = new Set(["pass", "fail", "skipped"]);

type Read = ReadonlyMap<string, readonly unknown[]> | undefined;

const filled = (
  count: number,
  first: string,
  rest: string,
): readonly string[] =>
  Array.from({ length: Math.min(count, MOST_ENTRIES) }, (_, at) =>
    at === 0 ? first : rest,
  );

const ended = (
  ok: boolean,
  statuses: readonly string[],
  said: string,
  count = statuses.length,
): Outcome => ({
  ok,
  output: {
    items: statuses.map(() => ""),
    results: statuses.map(() => ({})),
    statuses: [...statuses],
    count,
  },
  said,
});

/** Statuses a condition reads that an item of this type can report. */
const otherStatuses = (node: Node, read: Read): string[] => {
  const status = itemSays(node).fields.find(({ field }) => field === "status");
  const asked = (read?.get("statuses") ?? [])
    .flat()
    .filter((value): value is string => typeof value === "string");
  const allowed = (value: string): boolean =>
    !CONSTANT.has(value) &&
    (status?.open === true || status?.values?.includes(value) === true);
  return withValues([], asked).filter(
    (value): value is string => typeof value === "string" && allowed(value),
  );
};

/** Lengths a condition on `count` asks about, of a list that has items. */
const countsRead = (read: Read): number[] =>
  (read?.get("count") ?? []).filter(
    (value): value is number =>
      typeof value === "number" && Number.isInteger(value) && value > 0,
  );

/** The ways a list of `count` items can end. */
const atCount = (
  count: number,
  forEach: ForEach,
  extras: readonly string[],
  readsStatuses: boolean,
  suffix: string,
): Outcome[] => {
  const named = (words: string): string => `${words}${suffix}`;
  const stops = forEach.onFailure === "stop";
  const fails = [
    ended(
      false,
      filled(count, "fail", stops ? "skipped" : "pass"),
      named("one item failed"),
      count,
    ),
  ];
  // One lane at a time stops at the first failure.
  const oneByOne = stops && forEach.maxParallel === 1;
  if (readsStatuses && count > 1 && !oneByOne) {
    fails.push(
      ended(false, filled(count, "fail", "fail"), named("all failed"), count),
    );
    if (stops) {
      // Those already running when it failed finish their turn.
      fails.push(
        ended(
          false,
          filled(count, "fail", "pass"),
          named("one of a lane failed"),
          count,
        ),
      );
    }
  }
  return [
    ended(true, filled(count, "pass", "pass"), named("succeeded"), count),
    ...extras.map(status =>
      ended(
        true,
        filled(count, status, "pass"),
        named(`one said ${status}`),
        count,
      ),
    ),
    ...fails,
  ];
};

/**
 * A `from:` list can also be empty, or over its cap, with each answer. Those
 * that succeed route alike unless something reads what they gathered.
 */
const onlyFromALaterList = (maxItems: number, gathered: boolean): Outcome[] => [
  ...(gathered
    ? [
        ended(true, [], "the list is empty"),
        ended(
          true,
          filled(maxItems, "pass", "pass"),
          "over maxItems, ran the first",
          maxItems,
        ),
        ended(
          true,
          filled(maxItems + 1, "pass", "pass"),
          "over maxItems, ran all",
          maxItems + 1,
        ),
      ]
    : []),
  {
    ok: false,
    output: { status: "fail", summary: "" },
    said: "over maxItems, stopped",
    stopsRun: true,
  },
];

/** A fanned node's outcomes, and whether a walk tried too few to say more. */
export const gatheredOutcomes = (
  node: Node,
  forEach: ForEach,
  read: Read,
): { outcomes: Outcome[]; cutShort: boolean } => {
  const fromList = "from" in forEach;
  const usual = fromList ? Math.min(2, forEach.maxItems) : forEach.items.length;
  const readsStatuses = read?.has("statuses") === true;
  const extras = otherStatuses(node, read);
  const also = fromList
    ? withValues([], countsRead(read)).filter(count => count !== usual)
    : [];
  const all = [
    ...atCount(usual, forEach, extras, readsStatuses, ""),
    ...(fromList
      ? onlyFromALaterList(forEach.maxItems, (read?.size ?? 0) > 0)
      : []),
    ...also.flatMap(count =>
      typeof count === "number"
        ? atCount(
            count,
            forEach,
            extras,
            readsStatuses,
            `, count = ${String(count)}`,
          )
        : [],
    ),
  ];
  const longest = fromList ? forEach.maxItems : forEach.items.length;
  const otherRead = [...(read?.keys() ?? [])].some(
    field => field !== "statuses" && field !== "count",
  );
  return {
    outcomes: all.slice(0, MOST_OUTCOMES),
    cutShort:
      all.length > MOST_OUTCOMES ||
      otherRead ||
      (readsStatuses && longest > TRIED_COMPLETELY),
  };
};
