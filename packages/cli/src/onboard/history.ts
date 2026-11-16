/**
 * @file What a return visit to `ork onboard` learns from the store, with no
 *   model: per workflow of this project, how its runs ended, what they cost,
 *   what usage hints say, the open feedback items they raised and the open
 *   follow-ups they left. Another project's records, and Ork's own built-in
 *   runs, are left out. Bounded in size, and rendered as text for a prompt.
 */

import {
  type EventStore,
  type FeedbackItem,
  type FollowUp,
  type RunRecord,
  type StoredRunStatus,
  usageReport,
} from "@krapht/ork-core";

import { capped, oneLine } from "./text.ts";

const MAX_WORKFLOWS = 15;
const MAX_ITEMS = 8;
const MAX_HINTS = 4;

export type HistoryFeedback = Pick<
  FeedbackItem,
  "id" | "title" | "kind" | "severity" | "count"
>;

export type HistoryFollowUp = Pick<
  FollowUp,
  "id" | "title" | "for" | "kind" | "due" | "status"
>;

export type WorkflowHistory = {
  workflow: string;
  runs: number;
  /** How many runs ended each way (`running` for one still going). */
  ended: Partial<Record<StoredRunStatus, number>>;
  costUsd: number;
  /** Counted tokens (input, output, cache-write), for drivers with no dollars. */
  tokens: number;
  /** Some run's driver reports no dollars: `costUsd` misses it. */
  partial: boolean;
  lastRunAt: string;
  /** Usage's hints for this workflow, as `ork usage` words them. */
  hints: string[];
  /** Open items its runs raised, worst first. */
  feedback: HistoryFeedback[];
  /** Open follow-ups its runs left. */
  followUps: HistoryFollowUp[];
};

export type History = {
  /** This project's runs counted, the built-ins' left out. */
  runs: number;
  /** Most runs first; at most 15. */
  workflows: WorkflowHistory[];
  /** Workflows left out for the size limit. */
  moreWorkflows: number;
  /** Open follow-ups that name no run of this project. */
  followUps: HistoryFollowUp[];
};

/** An empty history: a first visit. */
export const EMPTY_HISTORY: History = {
  runs: 0,
  workflows: [],
  moreWorkflows: 0,
  followUps: [],
};

/** A run of one of Ork's built-in workflows: written under `.ork/runs/.builtin`. */
export const isBuiltinRun = (run: RunRecord): boolean =>
  run.file.replaceAll("\\", "/").includes("/.ork/runs/.builtin/");

const SEVERITY_RANK = { high: 0, medium: 1, low: 2 } as const;

const worstFirst = (a: HistoryFeedback, b: HistoryFeedback): number =>
  SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.count - a.count;

const feedbackOf = (item: FeedbackItem): HistoryFeedback => ({
  id: item.id,
  title: oneLine(item.title),
  kind: item.kind,
  severity: item.severity,
  count: item.count,
});

const followUpOf = (f: FollowUp): HistoryFollowUp => ({
  id: f.id,
  title: oneLine(f.title),
  for: f.for,
  kind: f.kind,
  due: f.due,
  status: f.status,
});

/**
 * The history of the project at `root` (its registered root), from `store`
 * alone. `EMPTY_HISTORY` with no run of its own.
 */
export const readHistory = (store: EventStore, root: string): History => {
  const runs = store.runs({ project: root }).filter(r => !isBuiltinRun(r));
  if (runs.length === 0) return EMPTY_HISTORY;
  const workflowOf = new Map(runs.map(r => [r.id, r.workflow]));
  const byWorkflow = Map.groupBy(runs, r => r.workflow);
  const items = store.feedbackItems();
  const open = store
    .followUps(root)
    .filter(f => f.status === "waiting" || f.status === "due");
  const unplaced: FollowUp[] = [];
  const placed = new Map<string, FollowUp[]>();
  for (const f of open) {
    const workflow =
      f.from.run === undefined ? undefined : workflowOf.get(f.from.run);
    if (workflow === undefined) unplaced.push(f);
    else placed.set(workflow, [...(placed.get(workflow) ?? []), f]);
  }
  const all = [...byWorkflow]
    .toSorted(([, a], [, b]) => b.length - a.length)
    .map(([workflow, own]): WorkflowHistory => {
      const ended: WorkflowHistory["ended"] = {};
      for (const r of own) ended[r.status] = (ended[r.status] ?? 0) + 1;
      const ids = new Set(own.map(r => r.id));
      const hints = usageReport(
        store.usage({ project: root, workflow }),
      ).hints.map(h => oneLine(h.message, 240));
      return {
        workflow,
        runs: own.length,
        ended,
        costUsd: own.reduce((sum, r) => sum + r.costUsd, 0),
        tokens: own.reduce((sum, r) => sum + (r.tokens ?? 0), 0),
        partial: own.some(r => r.partial === true),
        lastRunAt: own.reduce(
          (latest, r) => (r.startedAt > latest ? r.startedAt : latest),
          "",
        ),
        hints: hints.slice(0, MAX_HINTS),
        feedback: items
          .filter(item => item.runs.some(id => ids.has(id)))
          .map(item => feedbackOf(item))
          .toSorted((a, b) => worstFirst(a, b))
          .slice(0, MAX_ITEMS),
        followUps: (placed.get(workflow) ?? [])
          .slice(0, MAX_ITEMS)
          .map(f => followUpOf(f)),
      };
    });
  const { shown, more } = capped(all, MAX_WORKFLOWS);
  return {
    runs: runs.length,
    workflows: shown,
    moreWorkflows: more,
    followUps: unplaced.slice(0, MAX_ITEMS).map(f => followUpOf(f)),
  };
};

const ENDINGS: readonly StoredRunStatus[] = [
  "succeeded",
  "failed",
  "budget_exhausted",
  "quota_exhausted",
  "timed_out",
  "interrupted",
  "running",
];

const spent = (w: WorkflowHistory): string =>
  `$${w.costUsd.toFixed(2)}${w.partial ? " (some sessions report no dollars)" : ""}, ${String(w.tokens)} tokens`;

/** Item ids are shortened to what `ork feedback show` takes. */
const SHORT_ID = 12;

/** The history as text for a prompt, and for the terminal. */
export const historyText = (history: History): string => {
  if (history.runs === 0) return "No runs of this project's workflows yet.";
  const lines = [`${String(history.runs)} runs of this project's workflows.`];
  for (const w of history.workflows) {
    const ended = ENDINGS.flatMap(status =>
      w.ended[status] === undefined
        ? []
        : [`${String(w.ended[status])} ${status.replaceAll("_", " ")}`],
    ).join(", ");
    lines.push(
      "",
      `${w.workflow}: ${String(w.runs)} runs (${ended}); ${spent(w)}; last ${w.lastRunAt}`,
      ...w.hints.map(h => `  hint: ${h}`),
      ...w.feedback.map(
        f =>
          `  feedback ${f.id.slice(0, SHORT_ID)} (${f.severity} ${f.kind}, ${String(f.count)}×): ${f.title}`,
      ),
      ...w.followUps.map(
        f =>
          `  follow-up ${f.id} (${f.status}, ${f.kind} for ${f.for}, due ${f.due}): ${f.title}`,
      ),
    );
  }
  if (history.moreWorkflows > 0) {
    lines.push("", `and ${String(history.moreWorkflows)} more workflows`);
  }
  if (history.followUps.length > 0) {
    lines.push(
      "",
      "Open follow-ups from no run here:",
      ...history.followUps.map(
        f => `  ${f.id} (${f.status}, ${f.kind} for ${f.for}): ${f.title}`,
      ),
    );
  }
  return lines.join("\n");
};
