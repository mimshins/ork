/**
 * @file Helpers for the store's tables: reading rows without type assertions,
 *   and writing several as one.
 */

import type { DatabaseSync } from "node:sqlite";

import type { RunEvent } from "../run/types.ts";

export type Row = Record<string, unknown> | undefined;

/** A text column, or `""` when it is null. */
export const text = (row: Row, key: string): string => {
  const value = row?.[key];
  return typeof value === "string" ? value : "";
};

/** An event as the store wrote it. */
export const eventOf = (data: string): RunEvent =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only append() writes this column, from a RunEvent
  JSON.parse(data) as RunEvent;

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
