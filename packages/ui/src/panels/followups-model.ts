/**
 * @file The Follow-ups panel's model: its filters and what each leaves, the
 *   list grouped as `ork follow-ups` groups it (by due, then by who it is for),
 *   the words a row and a summary use, and which buttons an item has, with the
 *   CLI each one stands for. Pure, so it is tested without a page.
 */

import type { Option } from "../components/select.tsx";
import type { FollowUpRow } from "../state/follow-ups.ts";
import { ALL_PROJECTS } from "../state/preferences.ts";

export type { FollowUpRow };

export type FollowUpsFilter = {
  status: string;
  kind: string;
  for: string;
  project: string;
};

/** The id as the CLI's twins write it. */
export const short = (id: string): string => id.slice(0, 6);

const isOpen = (f: FollowUpRow): boolean =>
  f.status === "due" || f.status === "waiting";

const STATUSES = ["open", "due", "waiting", "done", "dropped", "all"] as const;

const STATUS_WORDS: Record<(typeof STATUSES)[number], string> = {
  open: "Open",
  due: "Due",
  waiting: "Waiting",
  done: "Done",
  dropped: "Dropped",
  all: "All",
};

const inStatus = (f: FollowUpRow, status: string): boolean => {
  if (status === "all") return true;
  if (status === "open") return isOpen(f);
  return f.status === status;
};

/** What the filters leave, in the order the list draws it. */
export const shownRows = (
  rows: readonly FollowUpRow[],
  filter: FollowUpsFilter,
): FollowUpRow[] =>
  rows.filter(
    f =>
      inStatus(f, filter.status) &&
      (filter.kind === "all" || f.kind === filter.kind) &&
      (filter.for === "all" || f.for === filter.for) &&
      (filter.project === ALL_PROJECTS || f.projectId === filter.project),
  );

const counted = (label: string, count: number): string =>
  `${label} (${String(count)})`;

/** The Status options, each with how many it holds under the other filters. */
export const statusOptions = (
  rows: readonly FollowUpRow[],
  filter: FollowUpsFilter,
): Option[] =>
  STATUSES.map(value => ({
    value,
    label: counted(
      STATUS_WORDS[value],
      shownRows(rows, { ...filter, status: value }).length,
    ),
  }));

const KINDS = ["change", "message", "task", "check"] as const;

export const kindOptions = (
  rows: readonly FollowUpRow[],
  filter: FollowUpsFilter,
): Option[] => [
  {
    value: "all",
    label: counted(
      "All kinds",
      shownRows(rows, { ...filter, kind: "all" }).length,
    ),
  },
  ...KINDS.map(value => ({
    value,
    label: counted(value, shownRows(rows, { ...filter, kind: value }).length),
  })),
];

const FOR_ORDER = ["agent", "project:", "me", "person:"] as const;

const forRank = (value: string): number => {
  const at = FOR_ORDER.findIndex(prefix => value.startsWith(prefix));
  return at === -1 ? FOR_ORDER.length : at;
};

const byFor = (a: string, b: string): number =>
  forRank(a) - forRank(b) || a.localeCompare(b);

/** `agent`, `me`, then each `project:<name>` and `person:<name>` present. */
export const forOptions = (
  rows: readonly FollowUpRow[],
  filter: FollowUpsFilter,
): Option[] => {
  const present = [...new Set(rows.map(f => f.for))].toSorted((a, b) =>
    byFor(a, b),
  );
  return [
    {
      value: "all",
      label: counted("All", shownRows(rows, { ...filter, for: "all" }).length),
    },
    ...present.map(value => ({
      value,
      label: counted(value, shownRows(rows, { ...filter, for: value }).length),
    })),
  ];
};

export const rowsWords = (count: number): string =>
  count === 0
    ? "No follow-ups shown"
    : `${String(count)} follow-up${count === 1 ? "" : "s"} shown`;

/** "3 due, 5 waiting", "None due, 5 waiting" or "Nothing open". */
export const summaryOf = (rows: readonly FollowUpRow[]): string => {
  const due = rows.filter(f => f.status === "due").length;
  const waiting = rows.filter(f => f.status === "waiting").length;
  if (due + waiting === 0) return "Nothing open";
  return `${due === 0 ? "None" : String(due)} due, ${String(waiting)} waiting`;
};

/** What the list says when the filters leave nothing but something exists. */
export const noMatchWords = (rows: readonly FollowUpRow[]): string => {
  const open = rows.filter(f => isOpen(f)).length;
  return `No follow-ups match. ${String(open)} ${open === 1 ? "is" : "are"} open, ${String(rows.length)} in all. Choose Open or All in Status to see them.`;
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
