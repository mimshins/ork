/**
 * @file Holding a node to what it declares of its output (RFC-010): a missing
 *   field, the wrong type or a value outside the list is a problem to fail the
 *   node on, so a condition never quietly matches nothing. A declared list
 *   (RFC-013) is held to being a list, and each item to its shape. It reads the
 *   format's own shape; a field written out as JSON Schema stays the driver's
 *   to enforce. A list a resume hands back keeps the file's real values when it
 *   only differs by masking.
 */

import { type ForEach, markValue } from "@krapht/ork-schema";

import { listShape } from "../graph/says.ts";
import { maskReplacer } from "../store/mask.ts";

const TYPE_NAMES: Readonly<Record<string, string>> = {
  string: "text",
  number: "a number",
  integer: "a whole number",
  boolean: "true or false",
};

const FITS: Readonly<Record<string, (value: unknown) => boolean>> = {
  string: value => typeof value === "string",
  number: value => typeof value === "number",
  integer: value => Number.isInteger(value),
  boolean: value => typeof value === "boolean",
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const listed = (values: readonly unknown[]): string => {
  const names = values.map(value => markValue(String(value)));
  const last = names.pop();
  return names.length === 0
    ? String(last)
    : `${names.join(", ")} or ${String(last)}`;
};

const shown = (value: unknown): string => {
  const text =
    typeof value === "string"
      ? value
      : (JSON.stringify(value) ?? String(value));
  return markValue(text.length > 80 ? `${text.slice(0, 80)}…` : text);
};

/** What's wrong with one field, if it's a shape this can read. */
const fieldProblem = (
  name: string,
  rule: unknown,
  value: unknown,
): string | null => {
  const shape = listShape(rule);
  if (shape !== undefined) return listProblem(name, shape, value);
  const expected = Array.isArray(rule)
    ? listed(rule)
    : typeof rule === "string"
      ? TYPE_NAMES[rule]
      : undefined;
  if (expected === undefined) return null;
  if (value === undefined) return `${name} is missing, expected ${expected}`;
  const fits = Array.isArray(rule)
    ? rule.some(item => item === value)
    : FITS[String(rule)]?.(value);
  return fits === true
    ? null
    : `${name} is ${shown(value)}, expected ${expected}`;
};

const fieldProblems = (
  declared: Readonly<Record<string, unknown>>,
  value: Readonly<Record<string, unknown>>,
  prefix: string,
): string[] =>
  Object.entries(declared).flatMap(([name, rule]) => {
    const problem = fieldProblem(`${prefix}${name}`, rule, value[name]);
    return problem === null ? [] : [problem];
  });

/** What's wrong with one item; `name` says which, as `tasks[2]`. */
const itemProblems = (
  name: string,
  shape: Readonly<Record<string, unknown>>,
  item: unknown,
): string[] => {
  if (Object.keys(shape).length === 0) return [];
  return isRecord(item)
    ? fieldProblems(shape, item, `${name}.`)
    : [`${name} is ${shown(item)}, expected an object`];
};

/** Only the first bad item is named, so a long list can't flood the reason. */
const listProblem = (
  name: string,
  shape: Readonly<Record<string, unknown>>,
  value: unknown,
): string | null => {
  if (value === undefined) return `${name} is missing, expected a list`;
  if (!Array.isArray(value)) {
    return `${name} is ${shown(value)}, expected a list`;
  }
  const bad = value
    .map((item: unknown, index) =>
      itemProblems(`${name}[${index}]`, shape, item),
    )
    .find(problems => problems.length > 0);
  return bad === undefined ? null : bad.join("; ");
};

/**
 * What's wrong with `value` by this declaration, or `null`. With nothing
 * declared, nothing can be.
 */
export const declaredProblem = (
  declared: Readonly<Record<string, unknown>> | undefined,
  value: unknown,
): string | null => {
  if (declared === undefined || Object.keys(declared).length === 0) return null;
  if (!isRecord(value)) return `the result isn't a JSON object`;
  const problems = fieldProblems(declared, value, "");
  return problems.length === 0 ? null : problems.join("; ");
};

/**
 * The list a resume hands back. Events are stored masked, so a static list that
 * still masks to the record is the file's, with its real values.
 */
export const unmasked = (forEach: ForEach, recorded: unknown[]): unknown[] =>
  "items" in forEach &&
  JSON.stringify(forEach.items, maskReplacer) === JSON.stringify(recorded)
    ? [...forEach.items]
    : recorded;
