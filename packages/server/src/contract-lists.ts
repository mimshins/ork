/**
 * @file The list routes' filters in the API's contract (RFC-017, ADR-088,
 *   specs/cli/list-filters.md): each list takes the fields of its core table
 *   (the CLI's flags) as query params, every one a text the server checks with
 *   core's `parseFilters`; and `GET /api/list-fields` serves the tables'
 *   descriptions so the UI builds its filter bar without importing core. The
 *   field names are listed here, not read from core, so a browser bundle can
 *   use this module (like the rest of the contract it imports only `zod`); a
 *   test checks they equal the core tables'.
 */

import type { ListFieldType } from "@krapht/ork-core";
import { z } from "zod";

/** The lists that have filters, as the UI names them. */
export type ListName =
  | "runs"
  | "feedback"
  | "follow-ups"
  | "decisions"
  | "worktrees"
  | "usage";

/** A filter's value: any text; the handler checks it with core. */
const text = () => z.string().min(1).optional();

/**
 * A `since` or `until`: `all`, an age (`24h`), a day, or an ISO time. Read with
 * core by the handler, so a bad one is refused in the CLI's words.
 */
const time = text;

/** Each list's filter fields, by flag name, in its core table's order. */
const LIST_SHAPES = {
  runs: {
    status: text(),
    workflow: text(),
    project: text(),
    since: time(),
    until: time(),
  },
  feedback: {
    status: text(),
    kind: text(),
    severity: text(),
    workflow: text(),
    run: text(),
  },
  "follow-ups": {
    status: text(),
    for: text(),
    kind: text(),
    due: text(),
    project: text(),
  },
  decisions: { workflow: text(), run: text(), project: text() },
  worktrees: { run: text(), project: text() },
  usage: { workflow: text(), project: text(), since: time(), until: time() },
} as const satisfies Record<ListName, z.ZodRawShape>;

/** A list's filter fields as query params: its core table's, each optional. */
export const listShape = <L extends ListName>(list: L) => LIST_SHAPES[list];

/** Each list's field names, in its core table's order. */
export const LIST_FIELD_NAMES: Record<ListName, string[]> = {
  runs: Object.keys(LIST_SHAPES.runs),
  feedback: Object.keys(LIST_SHAPES.feedback),
  "follow-ups": Object.keys(LIST_SHAPES["follow-ups"]),
  decisions: Object.keys(LIST_SHAPES.decisions),
  worktrees: Object.keys(LIST_SHAPES.worktrees),
  usage: Object.keys(LIST_SHAPES.usage),
};

const Count = z.coerce.number().int().positive();

/** `GET /api/runs`: `runListTable`'s fields, and the newest `limit`. */
export const RunsQuerySchema = z.strictObject({
  limit: Count.optional(),
  ...LIST_SHAPES.runs,
});

/**
 * `GET /api/usage`: `usageListTable`'s fields; `since` and `until` also take
 * ISO times (`since` included, `until` not), as before.
 */
export const UsageQuerySchema = z.strictObject(LIST_SHAPES.usage);

/**
 * `GET /api/decisions`: `decisionListTable`'s fields; `workflow` is ANDed with
 * `run` or `project`.
 */
export const DecisionsQuerySchema = z.strictObject(LIST_SHAPES.decisions);

/** One filter field, as `GET /api/list-fields` sends it (no functions). */
export type ListFieldInfo = {
  /** The query param's, and the flag's, name. */
  name: string;
  /** The flag's help line. */
  description: string;
  type: ListFieldType;
  /** An `enum` field's values, in the order help shows them. */
  values?: string[];
  /** It takes `all` too: the whole list. */
  all?: true;
};

/** `GET /api/list-fields`: each list's fields. */
export type ListFieldsAnswer = Record<ListName, ListFieldInfo[]>;

export const LISTS_API = {
  listFields: { method: "GET", path: "/api/list-fields" },
} as const;

export type ListsResponses = { listFields: ListFieldsAnswer };
