/**
 * @file The shapes of a list's field table (RFC-017): the fields a list filters
 *   by, each one flag, and how a row's value is read; the CLI makes the flags,
 *   their checks and their completion from it.
 */

/**
 * How a field's value is read and matched: `enum` takes one of `values`, `text`
 * any word, `for` a follow-up's `agent`, `me`, `project:<name>` or
 * `person:<name>` (all three compared equal); `since` and `until` a time,
 * compared with the row's timestamp.
 */
export type ListFieldType = "enum" | "text" | "since" | "until" | "for";

/** `--status all`, `--project all`, `--since all`: the whole list. */
export const ALL = "all";

export type ListField<Row> = {
  /** The flag's name, without `--`. */
  name: string;
  /** The flag's help line. */
  description: string;
  type: ListFieldType;
  /** An `enum` field's values, in the order help and completion show them. */
  values?: readonly string[];
  /** It takes `all` too: the whole list, past the caller's default. */
  all?: true;
  /**
   * The row's value, or values (a feedback item's runs); a row without one
   * never matches. Absent for a field that only scopes the store read (a
   * `project`), which the caller applies.
   */
  get?: (row: Row) => string | readonly string[] | undefined;
};

export type ListTable<Row> = {
  fields: readonly ListField<Row>[];
  /** What `--ids` prints; absent for a list whose rows have none. */
  id?: (row: Row) => string;
};

/**
 * A field's name to its checked value: a `since` or `until` as an ISO time, or
 * `all`. A field not given is absent.
 */
export type ListFilter = Readonly<Record<string, string>>;

export type ListFilterResult =
  | { ok: true; filter: ListFilter }
  | { ok: false; error: string };
