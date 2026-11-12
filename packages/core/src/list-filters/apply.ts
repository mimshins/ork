/**
 * @file Keeps the rows a list's filter matches (RFC-017). The list's own order
 *   and `--limit` stay the caller's: filter, then order, then limit.
 */

import {
  ALL,
  type ListField,
  type ListFilter,
  type ListTable,
} from "./types.ts";

const fieldMatches = <Row>(
  field: ListField<Row>,
  row: Row,
  wanted: string | undefined,
): boolean => {
  // A scope-only field (no `get`) was applied by the caller's store read.
  if (wanted === undefined || wanted === ALL || field.get === undefined) {
    return true;
  }
  const got = field.get(row);
  if (got === undefined) return false;
  const values = typeof got === "string" ? [got] : got;
  if (field.type === "since") {
    return values.some(value => Date.parse(value) >= Date.parse(wanted));
  }
  if (field.type === "until") {
    return values.some(value => Date.parse(value) < Date.parse(wanted));
  }
  return values.includes(wanted);
};

/** The rows of `rows` every field of `filter` matches, in their order. */
export const applyFilters = <Row>(
  table: ListTable<Row>,
  rows: readonly Row[],
  filter: ListFilter,
): Row[] =>
  rows.filter(row =>
    table.fields.every(field => fieldMatches(field, row, filter[field.name])),
  );
