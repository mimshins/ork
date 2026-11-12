/**
 * @file Tests for the lists' field tables (RFC-017): the times `--since` and
 *   `--until` take, checking flag values against a table, matching rows, and
 *   the tables of the lists whose rows live in core.
 */

import { describe, expect, it } from "vitest";

import {
  agoTime,
  applyFilters,
  decisionListTable,
  FEEDBACK_KINDS,
  FEEDBACK_SEVERITIES,
  type FeedbackItem,
  feedbackListTable,
  FOLLOW_UP_KINDS,
  FOLLOW_UP_STATUSES,
  type FollowUp,
  followUpListTable,
  LIST_TABLES,
  type ListFilter,
  type ListTable,
  type OrkWorktree,
  parseFilters,
  parseLimit,
  type RunListRow,
  runListTable,
  sinceTime,
  untilTime,
  usageListTable,
  worktreeListTable,
} from "../src/index.ts";

const NOW = Date.parse("2026-11-03T12:00:00.000Z");

const run = (extra: Partial<RunListRow> = {}): RunListRow => ({
  id: "r1",
  workflow: "build",
  file: "/p/.ork/workflows/build.ork.yaml",
  project: "/p",
  status: "succeeded",
  pid: 1,
  startedAt: "2026-11-02T10:00:00.000Z",
  costUsd: 0,
  depth: 0,
  ...extra,
});

const item = (extra: Partial<FeedbackItem> = {}): FeedbackItem => ({
  id: "fp1",
  merged: [],
  status: "new",
  title: "slow",
  target: "ork",
  kind: "friction",
  severity: "low",
  sources: ["agent"],
  count: 1,
  firstSeen: "2026-11-01T10:00:00.000Z",
  lastSeen: "2026-11-01T10:00:00.000Z",
  runs: ["r1", "r2"],
  workflows: ["build", "plan"],
  models: [],
  ...extra,
});

const followUp = (extra: Partial<FollowUp> = {}): FollowUp => ({
  id: "f1",
  project: "/p",
  title: "remove the alias",
  body: "",
  for: "agent",
  kind: "change",
  due: "after-merge",
  where: [],
  from: {},
  status: "waiting",
  place: "store",
  createdAt: "2026-11-01T10:00:00.000Z",
  updatedAt: "2026-11-01T10:00:00.000Z",
  ...extra,
});

const worktree = (extra: Partial<OrkWorktree> = {}): OrkWorktree => ({
  runId: "r1",
  nodeId: "engine",
  recorded: true,
  path: "/w/engine",
  missing: false,
  dirty: false,
  changes: 0,
  ahead: 0,
  merged: false,
  inMainCheckout: false,
  ...extra,
});

const filterOf = <Row>(
  table: ListTable<Row>,
  given: Record<string, unknown>,
): ListFilter => {
  const parsed = parseFilters(table, given, NOW);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.filter;
};

const errorOf = <Row>(
  table: ListTable<Row>,
  given: Record<string, unknown>,
): string | undefined => {
  const parsed = parseFilters(table, given, NOW);
  return parsed.ok ? undefined : parsed.error;
};

/** Each field's `values`, by its name. */
const values = (fields: readonly { name: string; values?: unknown }[]) =>
  Object.fromEntries(fields.map(f => [f.name, f.values]));

describe("list times", () => {
  it("reads an age or a day, and refuses anything else", () => {
    expect(agoTime("7d", NOW)).toBe("2026-10-27T12:00:00.000Z");
    expect(agoTime("2w", NOW)).toBe("2026-10-20T12:00:00.000Z");
    expect(agoTime("24h", NOW)).toBe("2026-11-02T12:00:00.000Z");
    expect(agoTime("soon", NOW)).toBeNull();
    expect(sinceTime("2026-11-01", NOW)).toBe(
      new Date(2026, 10, 1).toISOString(),
    );
    expect(sinceTime("nope", NOW)).toBeNull();
    const today = new Date(NOW);
    const daysAgo = (days: number) =>
      new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate() - days,
      ).toISOString();
    expect(sinceTime("7d", NOW)).toBe(daysAgo(6));
    expect(sinceTime("2w", NOW)).toBe(daysAgo(13));
    expect(sinceTime("24h", NOW)).toBe("2026-11-02T12:00:00.000Z");
    expect(agoTime("0d", NOW)).toBeNull();
    expect(agoTime("99999999999d", NOW)).toBeNull();
    expect(sinceTime("2026-13-45", NOW)).toBeNull();
    expect(sinceTime("2026-02-30", NOW)).toBeNull();
  });

  it("takes --until's day whole", () => {
    expect(untilTime("2026-11-01")).toBe(new Date(2026, 10, 2).toISOString());
    expect(untilTime("7d")).toBeNull();
  });
});

describe("parseFilters", () => {
  it("keeps the values a table takes, times as ISO times, and all", () => {
    expect(
      filterOf(runListTable, {
        status: "failed",
        workflow: "build",
        project: "all",
        since: "24h",
        until: "2026-11-01",
        limit: "5",
        json: true,
      }),
    ).toEqual({
      status: "failed",
      workflow: "build",
      project: "all",
      since: "2026-11-02T12:00:00.000Z",
      until: new Date(2026, 10, 2).toISOString(),
    });
    expect(filterOf(runListTable, { status: "all", since: "all" })).toEqual({
      status: "all",
      since: "all",
    });
    expect(filterOf(followUpListTable, { for: "project:web" })).toEqual({
      for: "project:web",
    });
  });

  it("refuses a value naming the flag and what it takes", () => {
    expect(errorOf(followUpListTable, { kind: "chore" })).toBe(
      "--kind takes one of change, message, task, check, not `chore`.",
    );
    expect(errorOf(followUpListTable, { status: "open" })).toBe(
      "--status takes one of waiting, due, done, dropped, all, not `open`.",
    );
    expect(errorOf(feedbackListTable, { severity: "all" })).toBe(
      "--severity takes one of low, medium, high, not `all`.",
    );
    expect(errorOf(followUpListTable, { for: "bob" })).toBe(
      "--for takes agent, me, project:<name> or person:<name>, not `bob`.",
    );
    expect(errorOf(runListTable, { since: "soon" })).toBe(
      "--since takes an age (30d), a day (2026-11-01) or all, not `soon`.",
    );
    expect(errorOf(runListTable, { until: "all" })).toBe(
      "--until takes a day (2026-11-01), not `all`.",
    );
    expect(errorOf(runListTable, { workflow: "" })).toBe(
      "--workflow takes a value, not ``.",
    );
  });
});

describe("parseLimit", () => {
  it("takes a positive whole number only", () => {
    expect(parseLimit("5")).toBe(5);
    expect(parseLimit("20")).toBe(20);
    expect(
      ["0", "-1", "abc", "2.5", "", "05", "1e3", "99999999999999999"].map(
        text => parseLimit(text),
      ),
    ).toEqual([null, null, null, null, null, null, null, null]);
  });
});

describe("applyFilters", () => {
  it("matches a run's live status, else its stored one", () => {
    const rows = [
      run({ id: "a", status: "running", listed: "crashed" }),
      run({ id: "b", status: "running" }),
      run({ id: "c", status: "failed" }),
    ];
    const ids = (status: string) =>
      applyFilters(runListTable, rows, { status }).map(r => r.id);
    expect(ids("crashed")).toEqual(["a"]);
    expect(ids("running")).toEqual(["b"]);
    expect(ids("all")).toEqual(["a", "b", "c"]);
  });

  it("matches a run's start against --since and --until, and skips the project", () => {
    const rows = [
      run({ id: "old", startedAt: "2026-10-01T10:00:00.000Z" }),
      run({ id: "new", startedAt: "2026-11-03T10:00:00.000Z" }),
    ];
    const filter = filterOf(runListTable, { since: "7d", project: "web" });
    expect(applyFilters(runListTable, rows, filter).map(r => r.id)).toEqual([
      "new",
    ]);
    const until = filterOf(runListTable, { until: "2026-10-31" });
    expect(applyFilters(runListTable, rows, until).map(r => r.id)).toEqual([
      "old",
    ]);
  });

  it("matches any of a feedback item's runs and workflows", () => {
    const rows = [item(), item({ id: "fp2", runs: ["r3"], workflows: ["x"] })];
    const ids = (filter: ListFilter) =>
      applyFilters(feedbackListTable, rows, filter).map(i => i.id);
    expect(ids({ run: "r2" })).toEqual(["fp1"]);
    expect(ids({ workflow: "x" })).toEqual(["fp2"]);
    expect(ids({ kind: "bug" })).toEqual([]);
  });

  it("reads a dated follow-up as due by date", () => {
    const rows = [followUp(), followUp({ id: "f2", due: "2026-12-01" })];
    const ids = (filter: ListFilter) =>
      applyFilters(followUpListTable, rows, filter).map(f => f.id);
    expect(ids({ due: "date" })).toEqual(["f2"]);
    expect(ids({ due: "after-merge", for: "agent" })).toEqual(["f1"]);
    expect(ids({ for: "me" })).toEqual([]);
  });
});

describe("the core lists' tables", () => {
  it("take the core's value sets", () => {
    expect(values(followUpListTable.fields)).toMatchObject({
      status: FOLLOW_UP_STATUSES,
      kind: FOLLOW_UP_KINDS,
      due: ["now", "after-merge", "after-deploy", "date"],
    });
    expect(values(feedbackListTable.fields)).toMatchObject({
      status: [
        "new",
        "triaged",
        "accepted",
        "dismissed",
        "published",
        "resolved",
      ],
      kind: FEEDBACK_KINDS,
      severity: FEEDBACK_SEVERITIES,
    });
    expect(values(runListTable.fields)["status"]).toEqual([
      "running",
      "paused",
      "crashed",
      "succeeded",
      "failed",
      "budget_exhausted",
      "quota_exhausted",
      "timed_out",
      "interrupted",
    ]);
  });

  it("name each list's fields once, and say which have ids", () => {
    const names = Object.fromEntries(
      Object.entries(LIST_TABLES).map(([list, table]) => [
        list,
        table.fields.map(f => f.name),
      ]),
    );
    expect(names).toEqual({
      ps: ["status", "workflow", "project", "since", "until"],
      "feedback list": ["status", "kind", "severity", "workflow", "run"],
      "follow-ups list": ["status", "for", "kind", "due", "project"],
      "decide --list": ["workflow", "run", "project"],
      "worktrees list": ["run", "project"],
      usage: ["workflow", "project", "since", "until"],
    });
    expect(usageListTable.id).toBeUndefined();
    expect(decisionListTable.fields.every(f => f.get === undefined)).toBe(true);
    expect(worktreeListTable.id?.(worktree({ branch: "ork/r1/engine" }))).toBe(
      "ork/r1/engine",
    );
    expect(worktreeListTable.id?.(worktree())).toBe("/w/engine");
  });
});
