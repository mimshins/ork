/**
 * @file Helpers for the store's tables: reading rows without type assertions,
 *   writing several as one, and reading a driver id a stored run recorded
 *   before RFC-014 as today's, and a run's record, with its tokens from the
 *   usage ledger.
 */

import type { DatabaseSync } from "node:sqlite";

import { RETIRED_DRIVERS } from "@krapht/ork-integrations";

import type { RunEvent } from "../run/types.ts";
import { UNPRICED_DRIVERS } from "../usage/spend.ts";
import type { RunRecord, StoredRunStatus } from "./types.ts";

export type Row = Record<string, unknown> | undefined;

/** A text column, or `""` when it is null. */
export const text = (row: Row, key: string): string => {
  const value = row?.[key];
  return typeof value === "string" ? value : "";
};

/**
 * A driver id as a stored run recorded it, read as today's: `sdk` and `cli` are
 * `claude-code` (RFC-014). The stored row is never rewritten.
 */
export const currentDriver = (id: string): string =>
  Object.hasOwn(RETIRED_DRIVERS, id) ? (RETIRED_DRIVERS[id] ?? id) : id;

/** The event fields that name a driver: a session's, a run's settings'. */
const DRIVER_KEYS = new Set(["driver", "readyDriver"]);

/** An event as the store wrote it, with a retired driver id read as today's. */
export const eventOf = (data: string): RunEvent =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only append() writes this column, from a RunEvent
  JSON.parse(data, (key, value: unknown) =>
    DRIVER_KEYS.has(key) && typeof value === "string"
      ? currentDriver(value)
      : value,
  ) as RunEvent;

/**
 * Runs `work` as one write, or not at all. It takes the write lock first, so it
 * waits its turn rather than failing when another process is writing.
 */
export const inTransaction = <T>(db: DatabaseSync, work: () => T): T => {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
};

/** The unpriced drivers as an SQL list. */
const UNPRICED_SQL =
  UNPRICED_DRIVERS.map(id => ["'", id, "'"].join("")).join(", ") || "NULL";

/**
 * A run's row, with its nodes' counted tokens and whether a session ran on a
 * driver that reports no dollars (RFC-015), from the usage ledger.
 */
export const RUN_COLUMNS = `runs.*,
  (SELECT COALESCE(SUM(input_tokens + output_tokens + cache_write_tokens), 0)
    FROM usage WHERE usage.run_id = runs.id AND kind = 'node') AS tokens,
  EXISTS (SELECT 1 FROM usage WHERE usage.run_id = runs.id
    AND driver IN (${UNPRICED_SQL})) AS partial`;

/** A run row's `tokens` and `partial`, as `RUN_COLUMNS` reads them. */
export const spendOfRow = (row: Row): { tokens?: number; partial?: true } => {
  const tokens = Number(row?.["tokens"] ?? 0);
  return {
    ...(tokens > 0 ? { tokens } : {}),
    ...(Number(row?.["partial"] ?? 0) === 1 ? { partial: true } : {}),
  };
};

const STATUSES: readonly StoredRunStatus[] = [
  "running",
  "succeeded",
  "failed",
  "budget_exhausted",
  "quota_exhausted",
  "timed_out",
  "interrupted",
];

const statusOf = (value: string): StoredRunStatus =>
  STATUSES.find(s => s === value) ?? "failed";

/** A run's record from its row, read with `RUN_COLUMNS`. */
export const recordOf = (row: Row): RunRecord => {
  const record: RunRecord = {
    id: text(row, "id"),
    workflow: text(row, "workflow"),
    file: text(row, "file"),
    project: text(row, "project"),
    status: statusOf(text(row, "status")),
    pid: Number(row?.["pid"]),
    startedAt: text(row, "started_at"),
    costUsd: Number(row?.["cost_usd"]),
    depth: Number(row?.["depth"] ?? 0),
    ...spendOfRow(row),
  };
  const processStart = text(row, "process_start");
  if (processStart !== "") record.processStart = processStart;
  const parent = text(row, "parent");
  if (parent !== "") record.parent = parent;
  const finished = text(row, "finished_at");
  if (finished !== "") record.finishedAt = finished;
  const skipped = row?.["skipped"];
  if (typeof skipped === "number") record.skipped = skipped;
  const handled = row?.["failures_handled"];
  if (typeof handled === "number") record.failuresHandled = handled;
  return record;
};
