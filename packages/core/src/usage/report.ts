/**
 * @file Usage reports (specs/usage.md): pure functions from the ledger's rows
 *   to totals, the same totals by day, workflow, model and more, and hints at
 *   what to look at first. No model is involved: every hint is a threshold on
 *   these numbers.
 */

import type { UsageRow } from "../store/types.ts";

export type UsageTotals = {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  turns: number;
  durationMs: number;
  sessions: number;
  runs: number;
  /** Spent in sessions that errored or reported `fail`. */
  failedUsd: number;
  /** Spent in a node's rounds after its first: loops sending work back. */
  reworkUsd: number;
  /** Spent in `ork chat`, which a run's own cost leaves out. */
  chatUsd: number;
  /** The share of input tokens read from the prompt cache, 0 to 1. */
  cacheHitRate: number;
};

export type UsageGroup = UsageTotals & { key: string };

export const USAGE_DIMENSIONS = [
  "day",
  "week",
  "month",
  "workflow",
  "node",
  "model",
  "driver",
  "project",
] as const;

export type UsageDimension = (typeof USAGE_DIMENSIONS)[number];

export type UsageHint = {
  code: "rework" | "failed" | "cache" | "concentrated";
  message: string;
};

export type UsageReport = {
  totals: UsageTotals;
  /** Times are oldest first; the rest are costliest first. */
  groups: Record<UsageDimension, UsageGroup[]>;
  hints: UsageHint[];
};

const pad = (value: number): string => String(value).padStart(2, "0");

/** `2026-11-03`, in the machine's own time zone. */
const dayOf = (date: Date): string =>
  `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** The Monday of a time's week. */
const weekOf = (date: Date): string => {
  const monday = new Date(date);
  monday.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return dayOf(monday);
};

const KEYS: Record<UsageDimension, (row: UsageRow) => string> = {
  day: row => dayOf(new Date(row.at)),
  week: row => weekOf(new Date(row.at)),
  month: row => dayOf(new Date(row.at)).slice(0, 7),
  workflow: row => row.workflow,
  node: row => `${row.workflow}/${row.template ?? row.node}`,
  model: row => row.model ?? "unknown",
  driver: row => row.driver ?? "unknown",
  project: row => row.project,
};

const TIMES: ReadonlySet<UsageDimension> = new Set(["day", "week", "month"]);

const totalsOf = (rows: readonly UsageRow[]): UsageTotals => {
  const totals: UsageTotals = {
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    turns: 0,
    durationMs: 0,
    sessions: rows.length,
    runs: new Set(rows.map(row => row.runId)).size,
    failedUsd: 0,
    reworkUsd: 0,
    chatUsd: 0,
    cacheHitRate: 0,
  };
  for (const row of rows) {
    totals.costUsd += row.costUsd;
    totals.inputTokens += row.inputTokens;
    totals.outputTokens += row.outputTokens;
    totals.cacheReadTokens += row.cacheReadTokens;
    totals.cacheWriteTokens += row.cacheWriteTokens;
    totals.turns += row.turns;
    totals.durationMs += row.durationMs;
    if (row.failed) totals.failedUsd += row.costUsd;
    if (row.kind === "chat") totals.chatUsd += row.costUsd;
    else if (row.round > 1) totals.reworkUsd += row.costUsd;
  }
  const read =
    totals.inputTokens + totals.cacheReadTokens + totals.cacheWriteTokens;
  totals.cacheHitRate = read === 0 ? 0 : totals.cacheReadTokens / read;
  return totals;
};

const groupBy = (
  rows: readonly UsageRow[],
  dimension: UsageDimension,
): UsageGroup[] => {
  const buckets = new Map<string, UsageRow[]>();
  for (const row of rows) {
    const key = KEYS[dimension](row);
    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, [row]);
    else bucket.push(row);
  }
  const groups = [...buckets].map(([key, bucket]) =>
    Object.assign(totalsOf(bucket), { key }),
  );
  return TIMES.has(dimension)
    ? groups.toSorted((a, b) => a.key.localeCompare(b.key))
    : groups.toSorted((a, b) => b.costUsd - a.costUsd);
};

/** Below this, a percentage says nothing worth acting on. */
const MIN_SPEND_USD = 0.5;
const REWORK_SHARE = 0.2;
const FAILED_SHARE = 0.1;
const CONCENTRATED_SHARE = 0.5;
const LOW_CACHE_RATE = 0.5;
const MIN_CACHE_TOKENS = 100_000;

const percent = (share: number): string =>
  `${String(Math.round(share * 100))}%`;

const hintsOf = (
  totals: UsageTotals,
  nodes: readonly UsageGroup[],
): UsageHint[] => {
  const spend = totals.costUsd;
  if (spend < MIN_SPEND_USD) return [];
  const hints: UsageHint[] = [];
  if (totals.reworkUsd / spend >= REWORK_SHARE) {
    hints.push({
      code: "rework",
      message: `${percent(totals.reworkUsd / spend)} of the spend went to loop rounds after the first. Sharper briefs or an earlier check can stop work coming back.`,
    });
  }
  if (totals.failedUsd / spend >= FAILED_SHARE) {
    hints.push({
      code: "failed",
      message: `${percent(totals.failedUsd / spend)} of the spend went to sessions that failed. A cheap check before them, or a lower budget per session, can stop them sooner.`,
    });
  }
  const top = nodes[0];
  if (
    top !== undefined &&
    nodes.length > 1 &&
    top.costUsd / spend >= CONCENTRATED_SHARE
  ) {
    hints.push({
      code: "concentrated",
      message: `${top.key} took ${percent(top.costUsd / spend)} of the spend. It is the first place to try a smaller model, a lower effort or a tighter brief.`,
    });
  }
  const read =
    totals.inputTokens + totals.cacheReadTokens + totals.cacheWriteTokens;
  if (read >= MIN_CACHE_TOKENS && totals.cacheHitRate < LOW_CACHE_RATE) {
    hints.push({
      code: "cache",
      message: `Only ${percent(totals.cacheHitRate)} of input tokens came from the prompt cache. Long runs of fresh sessions cost more than resumed ones.`,
    });
  }
  return hints;
};

/** Everything a report shows, from the ledger's rows. */
export const usageReport = (rows: readonly UsageRow[]): UsageReport => {
  const totals = totalsOf(rows);
  const groups: UsageReport["groups"] = {
    day: groupBy(rows, "day"),
    week: groupBy(rows, "week"),
    month: groupBy(rows, "month"),
    workflow: groupBy(rows, "workflow"),
    node: groupBy(rows, "node"),
    model: groupBy(rows, "model"),
    driver: groupBy(rows, "driver"),
    project: groupBy(rows, "project"),
  };
  return { totals, groups, hints: hintsOf(totals, groups.node) };
};
