/**
 * @file The filter fields a test server answers `GET /api/list-fields` with:
 *   the core tables' own words, so a bar under test shows what the CLI's help
 *   does. A test of the real route checks the server's answer equals the
 *   tables; this copy only needs to look like it.
 */

import type {
  ListFieldInfo,
  ListFieldsAnswer,
} from "@krapht/ork-server/client";

const PROJECT: ListFieldInfo = {
  name: "project",
  description:
    "A registered project's id or root, or all (default: the one you are in)",
  type: "text",
  all: true,
};

const WORKFLOW = (what: string): ListFieldInfo => ({
  name: "workflow",
  description: what,
  type: "text",
});

const RUN = (what: string): ListFieldInfo => ({
  name: "run",
  description: what,
  type: "text",
});

export const LIST_FIELDS: ListFieldsAnswer = {
  runs: [
    {
      name: "status",
      description:
        "Only runs in this status, or all: running, paused, crashed, succeeded, failed, budget_exhausted, quota_exhausted, timed_out, interrupted",
      type: "enum",
      values: [
        "running",
        "paused",
        "crashed",
        "succeeded",
        "failed",
        "budget_exhausted",
        "quota_exhausted",
        "timed_out",
        "interrupted",
      ],
      all: true,
    },
    WORKFLOW("Only this workflow's runs"),
    PROJECT,
    {
      name: "since",
      description:
        "Only runs started since an age (24h, 30d, 12w), a day (2026-11-01), or all",
      type: "since",
      all: true,
    },
    {
      name: "until",
      description: "Only runs started on or before this day (2026-11-01)",
      type: "until",
    },
  ],
  feedback: [
    {
      name: "status",
      description:
        "Only items in this status, or all (dismissed too): new, triaged, accepted, dismissed, published, resolved",
      type: "enum",
      values: [
        "new",
        "triaged",
        "accepted",
        "dismissed",
        "published",
        "resolved",
      ],
      all: true,
    },
    {
      name: "kind",
      description:
        "Only items of this kind: friction, bug, context-gap, skill, workflow, idea",
      type: "enum",
      values: ["friction", "bug", "context-gap", "skill", "workflow", "idea"],
    },
    {
      name: "severity",
      description: "Only items of this severity: low, medium, high",
      type: "enum",
      values: ["low", "medium", "high"],
    },
    WORKFLOW("Only items this workflow's runs reported"),
    RUN("Only items this run reported"),
  ],
  "follow-ups": [
    {
      name: "status",
      description:
        "Only follow-ups in this status, or all (default: due and waiting): waiting, due, done, dropped",
      type: "enum",
      values: ["waiting", "due", "done", "dropped"],
      all: true,
    },
    {
      name: "for",
      description: "Only those for agent, me, project:<name> or person:<name>",
      type: "for",
    },
    {
      name: "kind",
      description: "Only follow-ups of this kind: change, message, task, check",
      type: "enum",
      values: ["change", "message", "task", "check"],
    },
    {
      name: "due",
      description:
        "Only those due this way: now, after-merge, after-deploy, date (any dated one)",
      type: "enum",
      values: ["now", "after-merge", "after-deploy", "date"],
    },
    PROJECT,
  ],
  decisions: [
    WORKFLOW("Only the decisions of this workflow's runs"),
    RUN("Only this run's decisions (a run id or a prefix of one)"),
    PROJECT,
  ],
  worktrees: [RUN("Only this run's worktrees"), PROJECT],
  usage: [
    WORKFLOW("Only this workflow"),
    PROJECT,
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
