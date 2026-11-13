/**
 * @file The Follow-ups panel's model: the filter bar's help and how it reads a
 *   refusal, the list grouped as `ork follow-ups` groups it (by due, then by
 *   who it is for), the words a row and a summary use, and which buttons an
 *   item has, with the CLI each one stands for. Pure, so it is tested without a
 *   page.
 */

import { LIST_FIELD_NAMES } from "@krapht/ork-server/client";

import type { Suggestion } from "../components/filter-input.tsx";
import { errorField } from "../components/filter-model.ts";
import type { FollowUpRow } from "../state/follow-ups.ts";

export type { FollowUpRow };

/** The id as the CLI's twins write it. */
export const short = (id: string): string => id.slice(0, 6);

const FOR_ORDER = ["agent", "project:", "me", "person:"] as const;

const forRank = (value: string): number => {
  const at = FOR_ORDER.findIndex(prefix => value.startsWith(prefix));
  return at === -1 ? FOR_ORDER.length : at;
};

const byFor = (a: string, b: string): number =>
  forRank(a) - forRank(b) || a.localeCompare(b);

/**
 * The `for` values the rows have, as the bar's suggestions (`agent`, `me` are
 * its own).
 */
export const forSuggestions = (rows: readonly FollowUpRow[]): Suggestion[] =>
  [...new Set(rows.map(f => f.for))]
    .filter(value => value.includes(":"))
    .toSorted((a, b) => byFor(a, b))
    .map(value => ({ value, label: value }));

/**
 * The filter field a server refusal is about, when it is one: the message
 * starts with its flag (`--status takes …`); anything else is a failed read.
 */
export const refusalOf = (
  error: string,
): { message: string; field: string } | null => {
  const field = errorField(error);
  return field !== undefined && LIST_FIELD_NAMES["follow-ups"].includes(field)
    ? { message: error, field }
    : null;
};

/** "3 due, 5 waiting", "None due, 5 waiting" or "Nothing open". */
export const summaryOf = (rows: readonly FollowUpRow[]): string => {
  const due = rows.filter(f => f.status === "due").length;
  const waiting = rows.filter(f => f.status === "waiting").length;
  if (due + waiting === 0) return "Nothing open";
  return `${due === 0 ? "None" : String(due)} due, ${String(waiting)} waiting`;
};

export type DueGroup = {
  key: string;
  label: string;
  /** Sorts `Now` first, then after merge, after deploy, then dates. */
  order: string;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/u;

/** The day, `YYYY-MM-DD`, in local time. */
export const dayOf = (now: Date): string =>
  [
    String(now.getFullYear()),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");

export const dueGroupOf = (f: FollowUpRow, today: string): DueGroup => {
  if (f.due === "now") return { key: "now", label: "Now", order: "0" };
  if (f.due === "after-merge") {
    return { key: "after-merge", label: "After merge", order: "1" };
  }
  if (f.due === "after-deploy") {
    return { key: "after-deploy", label: "After deploy", order: "2" };
  }
  const overdue = DATE.test(f.due) && f.due < today;
  return {
    key: f.due,
    label: overdue ? `Overdue · ${f.due}` : `By ${f.due}`,
    order: `3${f.due}`,
  };
};

const ORDER = { due: 0, waiting: 1, done: 2, dropped: 3 } as const;

const inGroupOrder = (a: FollowUpRow, b: FollowUpRow): number =>
  ORDER[a.status] - ORDER[b.status] || b.createdAt.localeCompare(a.createdAt);

export type ForGroup = { for: string; rows: FollowUpRow[] };

export type Group = DueGroup & { groups: ForGroup[] };

/** By due, then by who it is for; empty groups are not drawn. */
export const groupRows = (
  rows: readonly FollowUpRow[],
  today: string,
): Group[] => {
  const byDue = new Map<string, { due: DueGroup; rows: FollowUpRow[] }>();
  for (const f of rows) {
    const due = dueGroupOf(f, today);
    const held = byDue.get(due.key);
    if (held === undefined) byDue.set(due.key, { due, rows: [f] });
    else held.rows.push(f);
  }
  return [...byDue.values()]
    .toSorted((a, b) => a.due.order.localeCompare(b.due.order))
    .map(({ due, rows: inDue }) => ({
      key: due.key,
      label: due.label,
      order: due.order,
      groups: [...new Set(inDue.map(f => f.for))]

        .toSorted((a, b) => byFor(a, b))
        .map(value => ({
          for: value,
          rows: inDue.filter(f => f.for === value).toSorted(inGroupOrder),
        })),
    }));
};

/** The rows in the order the list draws them, to move the focus across. */
export const orderedRows = (groups: readonly Group[]): FollowUpRow[] =>
  groups.flatMap(group => group.groups.flatMap(inFor => inFor.rows));

/** The ref as the row shows it: `#142`, or the branch. */
export const refWords = (ref: string): string => {
  const pull = /\/pull\/(\d+)/u.exec(ref);
  return pull === null ? ref : `#${pull[1] ?? ""}`;
};

/** A GitHub URL as `owner/name#142`, or as it is. */
export const githubTarget = (to: string): string => {
  const found = /github\.com\/([^/]+\/[^/]+)\/(?:pull|issues)\/(\d+)/u.exec(to);
  return found === null ? to : `${found[1] ?? ""}#${found[2] ?? ""}`;
};

const DAY_MS = 86_400_000;

/** Why a due row is due, when it is not the plain case. */
export const whyDue = (f: FollowUpRow, now: Date): string | undefined => {
  if (f.status !== "due") return undefined;
  const note = f.note ?? "";
  if (note.includes("closed without merging")) return "closed unmerged";
  if (note.endsWith(" merged")) return "PR merged";
  const dated = DATE.test(f.due) && f.due < dayOf(now);
  if (!dated) return undefined;
  const days = Math.floor(
    (Date.parse(`${dayOf(now)}T00:00:00Z`) - Date.parse(`${f.due}T00:00:00Z`)) /
      DAY_MS,
  );
  return `overdue ${String(days)} d`;
};

/** A message that is done was sent. */
export const isSent = (f: FollowUpRow): boolean =>
  f.status === "done" && f.kind === "message";

export const dueWord = (f: FollowUpRow): string =>
  f.due === "after-merge" || f.due === "after-deploy"
    ? f.due.replace("-", " ")
    : f.due;

/** The time now, in ms: a render reads it here, not in the component. */
export const nowMs = (): number => Date.now();
