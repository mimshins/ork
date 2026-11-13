/**
 * @file What the Feedback panel works out from the items and an item's detail
 *   (specs/feedback.md): the filters and their counts, what the list says with
 *   nothing to show, where the choice goes, and which buttons an item shows and
 *   whether each is enabled. Whether an action is allowed, and why not, comes
 *   from the server, by the rule `ork feedback` keeps too; nothing here makes
 *   up a rule of its own.
 */

import type { FeedbackDetail, FeedbackItem } from "@krapht/ork-server/client";

import type { Suggestion } from "../components/filter-input.tsx";
import type { FilterValues } from "../components/filter-model.ts";

/** An item's id as the CLI shows it. */
export const short = (id: string): string => id.slice(0, 12);

/**
 * The panel's filters: the bar's values (the server applies them; no status
 * means not dismissed, which the panel does) and the About select beside it.
 */
export type FeedbackFilter = { values: FilterValues; about: string };

/** The feedback list's default for `status`, in the bar's words. */
export const DEFAULTS = { status: "not dismissed" };

export const ABOUT_OPTIONS = [
  { value: "all", label: "All" },
  { value: "ork", label: "ork" },
  { value: "workflow", label: "workflow" },
  { value: "project", label: "project" },
];

const same = (value: string): Suggestion => ({ value, label: value });

/** What the bar suggests: the workflows and runs the items read come from. */
export const suggestionsOf = (
  items: readonly FeedbackItem[],
): { workflow: Suggestion[]; run: Suggestion[] } => {
  return {
    workflow: [...new Set(items.flatMap(item => item.workflows))]
      .toSorted((a, b) => a.localeCompare(b))
      .map(value => same(value)),
    run: [...new Set(items.flatMap(item => item.runs))].map(value =>
      same(value),
    ),
  };
};

/**
 * What the panel shows: both side by side when it's wide. When it's narrow, the
 * detail only of a chosen item, so a choice cleared while it was wide can't
 * leave an empty card in the list's place.
 */
export const panelShows = (
  narrow: boolean,
  showing: "list" | "detail",
  chosen: string | null,
): "list" | "detail" | "both" => {
  if (!narrow) return "both";
  return chosen === null ? "list" : showing;
};

/**
 * What the filters leave, most recently seen first as the server sends: the
 * server's answer, less the dismissed ones when no status is asked for, and
 * only what is about `about`.
 */
export const shownItems = (
  items: readonly FeedbackItem[],
  { values, about }: FeedbackFilter,
): FeedbackItem[] =>
  items.filter(
    item =>
      (values["status"] !== undefined || item.status !== "dismissed") &&
      (about === "all" || item.target === about),
  );

const counted = (count: number, one: string, many: string): string =>
  count === 1 ? `1 ${one}` : `${count.toLocaleString("en")} ${many}`;

export const itemsWords = (count: number): string =>
  counted(count, "item", "items");

export const timesWords = (count: number): string =>
  counted(count, "time", "times");

export const runsWords = (count: number): string =>
  counted(count, "run", "runs");

const NONE_WITH: Record<string, string> = {
  open: "No items",
  all: "No items",
  new: "No new items",
  triaged: "No triaged items",
  accepted: "No accepted items",
  resolved: "Nothing resolved",
  published: "Nothing published",
  dismissed: "Nothing dismissed",
};

/** What the list says when the filters leave nothing of what there is. */
export const emptyWords = ({
  status,
  about,
}: {
  /** The status asked for; `open` is the default, not dismissed. */
  status: string;
  about: string;
}): { title: string; body: string } => {
  const start = NONE_WITH[status] ?? "No items";
  const title =
    status === "open" && about === "all"
      ? "Every item is dismissed."
      : `${start}${about === "all" ? "" : ` about ${about}`}.`;
  const widen = [
    status === "all" ? [] : ["Status: All"],
    about === "all" ? [] : ["About: All"],
  ].flat();
  return {
    title,
    body: `${widen.join(" and ")} ${widen.length > 1 ? "show" : "shows"} every item.`,
  };
};

/** Where the choice goes when the chosen item leaves the list: on, or back. */
export const nextAfter = (
  before: readonly FeedbackItem[],
  after: readonly FeedbackItem[],
  gone: string,
): FeedbackItem | undefined => {
  const at = before.findIndex(({ id }) => id === gone);
  const left = after.filter(({ id }) => id !== gone);
  return left[Math.min(Math.max(at, 0), left.length - 1)];
};

/** The item `id` was merged into, if a read shows it was. */
export const mergedInto = (
  items: readonly FeedbackItem[],
  id: string,
): FeedbackItem | undefined => items.find(item => item.merged.includes(id));

export type Check = { ok: true } | { ok: false; why: string };

export type ActionKey = "accept" | "lesson" | "apply" | "publish";

export type ButtonSpec = {
  key: ActionKey;
  word: string;
  cli: string;
  variant: "default" | "primary";
  check: Check;
};

const READING: Check = { ok: false, why: "reading what it allows" };

const allowed = (
  check: FeedbackDetail["actions"]["accept"],
  ...then: (string | undefined)[]
): Check => {
  if (!check.ok) return { ok: false, why: check.why };
  const why = then.find(reason => reason !== undefined);
  return why === undefined ? { ok: true } : { ok: false, why };
};

/** A lesson needs a project for one of its workflows, at least. */
const lessonProblem = (detail: FeedbackDetail): string | undefined => {
  const places = detail.lessons;
  const [first] = places;
  return places.every(place => !place.ok) && first !== undefined && !first.ok
    ? first.error
    : undefined;
};

/**
 * The buttons an item shows, in order: which ones depends on what it's about,
 * and whether each is enabled on the server's answer for it. Dismiss and
 * Restore are always enabled, so they aren't here.
 */
export const buttonsFor = (
  item: FeedbackItem,
  detail: FeedbackDetail | null,
): ButtonSpec[] => {
  const id = short(item.id);
  const check = (key: ActionKey): Check => {
    if (detail === null) return READING;
    const { actions, project } = detail;
    if (key === "lesson") return allowed(actions.lesson, lessonProblem(detail));
    if (key === "apply") {
      return allowed(actions.apply, project.ok ? undefined : project.error);
    }
    return allowed(actions[key]);
  };
  const accept: ButtonSpec = {
    key: "accept",
    word: "Accept",
    cli: `ork feedback accept ${id}`,
    variant: "default",
    check: check("accept"),
  };
  if (item.target === "ork") {
    return [
      accept,
      {
        key: "publish",
        word: "Publish…",
        cli: `ork feedback publish ${id}`,
        variant: "primary",
        check: check("publish"),
      },
    ];
  }
  return [
    accept,
    {
      key: "lesson",
      word: "Add lesson…",
      cli: `ork feedback accept ${id} --lesson`,
      variant: "default",
      check: check("lesson"),
    },
    {
      key: "apply",
      word: "Propose fix…",
      cli: `ork feedback apply ${id}`,
      variant: "primary",
      check: check("apply"),
    },
  ];
};

/** A button's name: its words, then why it's off, when it is. */
export const labelOf = (word: string, check: Check): string =>
  check.ok ? word : `${word}: ${check.why}`;
