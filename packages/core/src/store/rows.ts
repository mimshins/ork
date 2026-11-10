/**
 * @file Helpers for the store's tables: reading rows without type assertions,
 *   writing several as one, and reading a driver id a stored run recorded
 *   before RFC-014 as today's.
 */

import type { DatabaseSync } from "node:sqlite";

import { RETIRED_DRIVERS } from "@krapht/ork-integrations";

import type { RunEvent } from "../run/types.ts";

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
