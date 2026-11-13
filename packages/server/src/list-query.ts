/**
 * @file Reads a list route's filter fields the way the CLI reads its flags
 *   (RFC-017, ADR-088): each value checked by core's `parseFilters` against the
 *   list's table, a refused one answered as 400 in the CLI's words. A full ISO
 *   time in `since` or `until` is taken as given (the form `usage` had before
 *   the tables), the rest are an age, a day or `all`.
 */

import {
  ALL,
  type ListFilter,
  type ListTable,
  parseFilters,
} from "@krapht/ork-core";

import { projectOf, type ServerContext } from "./context.ts";
import { fail } from "./router.ts";

type Query = Readonly<Record<string, unknown>>;

/** A `2026-11-01T10:00:00Z`-style time, as an ISO time; else `undefined`. */
const isoTime = (value: unknown): string | undefined => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/u.test(value)) {
    return undefined;
  }
  const time = Date.parse(value);
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
};

/**
 * The filter `query` asks for, checked against `table`; a value the table
 * refuses is a 400.
 */
export const filterOf = <Row>(
  table: ListTable<Row>,
  query: Query,
):
  | { ok: true; filter: ListFilter }
  | { ok: false; refusal: ReturnType<typeof fail> } => {
  const times: Record<string, string> = {};
  const rest: Record<string, unknown> = { ...query };
  for (const name of ["since", "until"]) {
    const iso = isoTime(query[name]);
    if (iso === undefined) continue;
    times[name] = iso;
    delete rest[name];
  }
  const parsed = parseFilters(table, rest, Date.now());
  return parsed.ok
    ? { ok: true, filter: { ...parsed.filter, ...times } }
    : { ok: false, refusal: fail(400, parsed.error) };
};

/**
 * The root a filter's `project` names (a registered project's id or root, else
 * the value as a root); `undefined` without one or for `all`.
 */
export const projectRootOf = (
  context: ServerContext,
  filter: ListFilter,
): string | undefined => {
  const key = filter["project"];
  return key === undefined || key === ALL
    ? undefined
    : (projectOf(context, key)?.root ?? key);
};
