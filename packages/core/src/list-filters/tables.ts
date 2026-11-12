/**
 * @file The field tables of the lists whose rows live in core (RFC-017): `ork
 *   ps`, `feedback list`, `follow-ups list`, `decide --list`, `worktrees list`
 *   and `usage`. Each says which flags filter it and what `--ids` prints; each
 *   list's default (follow-ups due and waiting, feedback without the dismissed,
 *   `ps`'s 20 of this project) stays its command's.
 */

import { FEEDBACK_KINDS, FEEDBACK_SEVERITIES } from "../feedback/types.ts";
import {
  FOLLOW_UP_KINDS,
  FOLLOW_UP_STATUSES,
  type FollowUp,
} from "../follow-ups/types.ts";
import type {
  DecisionRecord,
  FeedbackItem,
  FeedbackStatus,
  RunRecord,
  StoredRunStatus,
} from "../store/types.ts";
import type { UsageRow } from "../store/usage-types.ts";
import { keyOf } from "../worktree/clean.ts";
import type { OrkWorktree } from "../worktree/list.ts";
import type { ListField, ListTable } from "./types.ts";

/**
 * A scope-only field: a registered project's id or root, or `all`; the caller
 * reads the store for it, and refuses one not registered.
 */
const projectField = <Row>(): ListField<Row> => ({
  name: "project",
  description:
    "A registered project's id or root, or all (default: the one you are in)",
  type: "text",
  all: true,
});

/** What `--status` matches on `ork ps`: the stored status, or the live one. */
export const RUN_LIST_STATUSES = [
  "running",
  "paused",
  "crashed",
  "succeeded",
  "failed",
  "budget_exhausted",
  "quota_exhausted",
  "timed_out",
  "interrupted",
] as const satisfies readonly (StoredRunStatus | "crashed" | "paused")[];
export type RunListStatus = (typeof RUN_LIST_STATUSES)[number];

/**
 * A run as `ork ps` lists it: `listed` is `runStatus`'s for a running run whose
 * events were read (`paused`, `crashed`); a lock or slot wait is `running`.
 */
export type RunListRow = RunRecord & {
  listed?: StoredRunStatus | "crashed" | "paused";
};

// Typed so a status added to the store fails here until it is listed.
const runStatusOf = (run: RunListRow): RunListStatus =>
  run.listed ?? run.status;

/** `ork ps`. */
export const runListTable: ListTable<RunListRow> = {
  fields: [
    {
      name: "status",
      description: `Only runs in this status, or all: ${RUN_LIST_STATUSES.join(", ")}`,
      type: "enum",
      values: RUN_LIST_STATUSES,
      all: true,
      get: runStatusOf,
    },
    {
      name: "workflow",
      description: "Only this workflow's runs",
      type: "text",
      get: run => run.workflow,
    },
    projectField(),
    {
      name: "since",
      description:
        "Only runs started since an age (24h, 30d, 12w), a day (2026-11-01), or all",
      type: "since",
      all: true,
      get: run => run.startedAt,
    },
    {
      name: "until",
      description: "Only runs started on or before this day (2026-11-01)",
      type: "until",
      get: run => run.startedAt,
    },
  ],
  id: run => run.id,
};

/** A feedback item's statuses, in triage's order. */
export const FEEDBACK_STATUSES = [
  "new",
  "triaged",
  "accepted",
  "dismissed",
  "published",
  "resolved",
] as const satisfies readonly FeedbackStatus[];

// Typed so a status added to the store fails here until it is listed.
const feedbackStatusOf = (
  item: FeedbackItem,
): (typeof FEEDBACK_STATUSES)[number] => item.status;

/** `ork feedback list`. */
export const feedbackListTable: ListTable<FeedbackItem> = {
  fields: [
    {
      name: "status",
      description: `Only items in this status, or all (dismissed too): ${FEEDBACK_STATUSES.join(", ")}`,
      type: "enum",
      values: FEEDBACK_STATUSES,
      all: true,
      get: feedbackStatusOf,
    },
    {
      name: "kind",
      description: `Only items of this kind: ${FEEDBACK_KINDS.join(", ")}`,
      type: "enum",
      values: FEEDBACK_KINDS,
      get: item => item.kind,
    },
    {
      name: "severity",
      description: `Only items of this severity: ${FEEDBACK_SEVERITIES.join(", ")}`,
      type: "enum",
      values: FEEDBACK_SEVERITIES,
      get: item => item.severity,
    },
    {
      name: "workflow",
      description: "Only items this workflow's runs reported",
      type: "text",
      get: item => item.workflows,
    },
    {
      name: "run",
      description: "Only items this run reported",
      type: "text",
      get: item => item.runs,
    },
  ],
  id: item => item.id,
};

/**
 * What `--due` matches: when a follow-up comes due; `date` is any with a
 * `YYYY-MM-DD` date.
 */
export const FOLLOW_UP_DUES = [
  "now",
  "after-merge",
  "after-deploy",
  "date",
] as const;

/** `ork follow-ups list`. */
export const followUpListTable: ListTable<FollowUp> = {
  fields: [
    {
      name: "status",
      description: `Only follow-ups in this status, or all (default: due and waiting): ${FOLLOW_UP_STATUSES.join(", ")}`,
      type: "enum",
      values: FOLLOW_UP_STATUSES,
      all: true,
      get: f => f.status,
    },
    {
      name: "for",
      description: "Only those for agent, me, project:<name> or person:<name>",
      type: "for",
      get: f => f.for,
    },
    {
      name: "kind",
      description: `Only follow-ups of this kind: ${FOLLOW_UP_KINDS.join(", ")}`,
      type: "enum",
      values: FOLLOW_UP_KINDS,
      get: f => f.kind,
    },
    {
      name: "due",
      description: `Only those due this way: ${FOLLOW_UP_DUES.join(", ")} (any dated one)`,
      type: "enum",
      values: FOLLOW_UP_DUES,
      get: f => (/^\d{4}-\d{2}-\d{2}$/u.test(f.due) ? "date" : f.due),
    },
    projectField(),
  ],
  id: f => f.id,
};

/** `ork decide --list`: every field scopes the store read. */
export const decisionListTable: ListTable<DecisionRecord> = {
  fields: [
    {
      name: "workflow",
      description: "Only the decisions of this workflow's runs",
      type: "text",
    },
    {
      name: "run",
      description: "Only this run's decisions (a run id or a prefix of one)",
      type: "text",
    },
    projectField(),
  ],
  id: decision => decision.id,
};

/** `ork worktrees list`; the id is what `ork worktrees remove` takes. */
export const worktreeListTable: ListTable<OrkWorktree> = {
  fields: [
    {
      name: "run",
      description: "Only this run's worktrees",
      type: "text",
      get: item => item.runId,
    },
    projectField(),
  ],
  id: keyOf,
};

/**
 * `ork usage`: parse only, its values go straight into `store.usage`'s
 * `UsageFilter`, which filters; its rows have no id.
 */
export const usageListTable: ListTable<UsageRow> = {
  fields: [
    { name: "workflow", description: "Only this workflow", type: "text" },
    projectField(),
    {
      name: "since",
      description:
        "Whole days counting today (30d, 12w), exact hours (24h), a day (2026-11-01), or all",
      type: "since",
      all: true,
    },
    { name: "until", description: "The last day to include", type: "until" },
  ],
};

/** Every core list's table, by the command that lists it. */
export const LIST_TABLES = {
  ps: runListTable,
  "feedback list": feedbackListTable,
  "follow-ups list": followUpListTable,
  "decide --list": decisionListTable,
  "worktrees list": worktreeListTable,
  usage: usageListTable,
} as const;
