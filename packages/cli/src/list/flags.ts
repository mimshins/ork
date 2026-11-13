/**
 * @file The flags every list command shares (RFC-017), made from its field
 *   table: one flag per field (an enum field's values as citty `options`, so
 *   `--help` and Tab completion read them), `--ids`, `--limit` and `--json`;
 *   and reading them back: each value checked by core's `parseFilters`,
 *   `--limit` a positive whole number, `--project` a registered one. A refusal
 *   says why on stderr and sets the exit code; the command then returns.
 */

import {
  ALL,
  type EventStore,
  findRun,
  limitRefusal,
  type ListField,
  type ListFilter,
  type ListTable,
  parseFilters,
  parseLimit,
  unknownProjectRefusal,
} from "@krapht/ork-core";
import type { ArgDef, ArgsDef } from "citty";

import { writeErr } from "../output.ts";

/** Re-exported so every list command takes its flags and its refusals from here. */
export { refuseUnknownFlags } from "./known-flags.ts";

/** What `filterArgs` adds or leaves out beside a table's own flags. */
export type FilterArgsOptions = {
  /** `--ids`; default: when the table has an `id`. */
  ids?: boolean;
  /** `--limit`; default: on. */
  limit?: boolean;
  /** `--json`; default: on. */
  json?: boolean;
  /** The command's own flags, which win over a same-named one. */
  extra?: ArgsDef;
};

const fieldArg = <Row>(field: ListField<Row>): ArgDef => {
  if (field.type !== "enum") {
    return { type: "string", description: field.description };
  }
  const values = [
    ...(field.values ?? []),
    ...(field.all === true ? [ALL] : []),
  ];
  return { type: "enum", options: values, description: field.description };
};

/** The citty flags of `table`, then `--ids`, `--limit`, `--json`, `extra`. */
export const filterArgs = <Row>(
  table: ListTable<Row>,
  options: FilterArgsOptions = {},
): ArgsDef => ({
  ...Object.fromEntries(
    table.fields.map(field => [field.name, fieldArg(field)]),
  ),
  ...((options.ids ?? table.id !== undefined)
    ? {
        ids: {
          type: "boolean",
          description: "Print only the ids, comma-separated, on one line",
          default: false,
        } satisfies ArgDef,
      }
    : {}),
  ...((options.limit ?? true)
    ? {
        limit: {
          type: "string",
          description: "Show at most this many (a positive whole number)",
        } satisfies ArgDef,
      }
    : {}),
  ...((options.json ?? true)
    ? {
        json: {
          type: "boolean",
          description: "Print JSON",
          default: false,
        } satisfies ArgDef,
      }
    : {}),
  ...options.extra,
});

/** Says why, and makes the command exit 1. */
export const fail = (message: string): void => {
  writeErr(message);
  process.exitCode = 1;
};

/** The `--ids` with `--json` refusal; `true` when `args` has both. */
export const refuseIdsWithJson = (args: {
  ids?: unknown;
  json?: unknown;
}): boolean => {
  if (args.ids !== true || args.json !== true) return false;
  fail("--ids and --json can't be used together.");
  return true;
};

/** What a list asks for, checked. */
export type ListRequest = {
  /** The fields given, each checked; times as ISO times. */
  filter: ListFilter;
  /** `--limit`; none when not given. */
  limit: number | undefined;
};

/**
 * `args` (a command's parsed flags) read against `table`: the filter, and the
 * limit. `undefined` when something was refused (already said, exit code set).
 */
export const readListArgs = <Row>(
  table: ListTable<Row>,
  args: Readonly<Record<string, unknown>>,
  options: { now?: number } = {},
): ListRequest | undefined => {
  if (refuseIdsWithJson(args)) return undefined;
  const parsed = parseFilters(table, args, options.now ?? Date.now());
  if (!parsed.ok) {
    fail(parsed.error);
    return undefined;
  }
  const text = args["limit"];
  if (typeof text !== "string")
    return { filter: parsed.filter, limit: undefined };
  const limit = parseLimit(text);
  if (limit === null) {
    fail(limitRefusal(text));
    return undefined;
  }
  return { filter: parsed.filter, limit };
};

/** Where `--project` points: `all`, one registered root, or where you are. */
export type ProjectScope = "all" | "here" | { root: string };

/**
 * The scope the filter's `project` names, checked against the registered
 * projects (core does not know them): an id or a root, or `all`; none given is
 * `here`. A project not registered is refused, listing the registered ones
 * (said, exit code set, `undefined`).
 */
export const projectScope = (
  filter: ListFilter,
  projects: readonly { id: string; root: string }[],
): ProjectScope | undefined => {
  const key = filter["project"];
  if (key === undefined) return "here";
  if (key === ALL) return ALL;
  const found = projects.find(p => p.id === key || p.root === key);
  if (found !== undefined) return { root: found.root };
  fail(
    unknownProjectRefusal(
      key,
      projects.map(p => p.id),
    ),
  );
  return undefined;
};

/**
 * `filter` with its `run` (a prefix) made the full id of the run it names, as
 * `ork decide --run` reads it; an unknown or ambiguous run is refused with
 * `findRun`'s message (said, exit code set, `undefined`). No `run` (or an empty
 * one) leaves `filter` as it is.
 */
export const resolveRun = (
  store: EventStore,
  filter: ListFilter,
): ListFilter | undefined => {
  const run = filter["run"];
  if (run === undefined || run === "") return filter;
  const found = findRun(store, run, process.cwd());
  if (!found.ok) {
    fail(found.error);
    return undefined;
  }
  return { ...filter, run: found.run.id };
};
