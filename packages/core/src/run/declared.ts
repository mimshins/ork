/**
 * @file Holding a node to what it declares of its output (RFC-010): a missing
 *   field, the wrong type or a value outside the list is a problem to fail the
 *   node on, so a condition never quietly matches nothing. It reads the
 *   format's own shape; a field written out as JSON Schema stays the driver's
 *   to enforce.
 */

import { markValue } from "@krapht/ork-schema";

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
  const problems = Object.entries(declared).flatMap(([name, rule]) => {
    const problem = fieldProblem(name, rule, value[name]);
    return problem === null ? [] : [problem];
  });
  return problems.length === 0 ? null : problems.join("; ");
};
