/**
 * @file Reads a list's filter flags against its field table (RFC-017): each
 *   value checked, times turned into ISO times, and `--limit`.
 */

import { sinceTime, untilTime } from "./time.ts";
import {
  ALL,
  type ListField,
  type ListFieldType,
  type ListFilterResult,
  type ListTable,
} from "./types.ts";

const FOR = /^(agent|me|(project|person):\S+)$/u;

/** The field's value, checked; `null` when the field does not take it. */
const valueOf = <Row>(
  field: ListField<Row>,
  text: string,
  now: number,
): string | null => {
  if (text === ALL && field.all === true) return ALL;
  const read: Record<ListFieldType, () => string | null> = {
    enum: () => (field.values?.includes(text) === true ? text : null),
    text: () => (text === "" ? null : text),
    for: () => (FOR.test(text) ? text : null),
    since: () => sinceTime(text, now),
    until: () => untilTime(text),
  };
  return read[field.type]();
};

/** What the field takes, for the error that refuses a value. */
const takes = <Row>(field: ListField<Row>): string => {
  const all = field.all === true ? [ALL] : [];
  const or = all.length === 0 ? "" : " or all";
  const said: Record<ListFieldType, string> = {
    enum: `one of ${[...(field.values ?? []), ...all].join(", ")}`,
    text: `a value${or}`,
    for: "agent, me, project:<name> or person:<name>",
    since: `an age (30d), a day (2026-11-01)${or}`,
    until: "a day (2026-11-01)",
  };
  return said[field.type];
};

/**
 * The filter `given` (a command's parsed flags, by field name) asks for, each
 * value checked against `table`; `now` dates an age. The first value a field
 * does not take is refused, naming the flag and what it takes.
 */
export const parseFilters = <Row>(
  table: ListTable<Row>,
  given: Readonly<Record<string, unknown>>,
  now: number,
): ListFilterResult => {
  const filter: Record<string, string> = {};
  for (const field of table.fields) {
    const text = given[field.name];
    if (typeof text !== "string") continue;
    const value = valueOf(field, text, now);
    if (value === null) {
      return {
        ok: false,
        error: `--${field.name} takes ${takes(field)}, not \`${text}\`.`,
      };
    }
    filter[field.name] = value;
  }
  return { ok: true, filter };
};

/** `--limit`: a positive whole number, else `null` (`0`, `-1`, `abc`, `2.5`). */
export const parseLimit = (text: string): number | null => {
  if (!/^[1-9]\d*$/u.test(text)) return null;
  const limit = Number(text);
  return Number.isSafeInteger(limit) ? limit : null;
};
