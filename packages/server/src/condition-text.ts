/**
 * @file Writing the builder's choices as a `when:` (RFC-010), the way a person
 *   would. It imports nothing, so the browser can use it; what it writes reads
 *   back through `readCondition` as the same choices.
 */

import type {
  Condition,
  ConditionRow,
  ConditionTest,
  ConditionValue,
} from "@krapht/ork-core";

const literal = (value: ConditionValue | undefined): string =>
  typeof value === "string"
    ? `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`
    : String(value ?? "''");

const OPERATORS: Partial<Record<ConditionTest, string>> = {
  is: "==",
  isnt: "!=",
  above: ">",
  atLeast: ">=",
  below: "<",
  atMost: "<=",
};

const CALLS: Partial<Record<ConditionTest, string>> = {
  anyIs: "any",
  allAre: "all",
  contains: "contains",
};

const rowText = ({ field, test, value }: ConditionRow): string => {
  if (test === "isTrue") return field;
  if (test === "isFalse") return `!${field}`;
  const call = CALLS[test];
  return call === undefined
    ? `${field} ${String(OPERATORS[test])} ${literal(value)}`
    : `${call}(${field}, ${literal(value)})`;
};

/** The `when:` for these choices; `undefined` for none at all. */
export const conditionText = (condition: Condition): string | undefined => {
  switch (condition.mode) {
    case "succeeds":
      return undefined;
    case "fails":
      return "!ok";
    case "otherwise":
      return "true";
    case "hand":
      return condition.text;
    case "test":
      return condition.rows
        .map(rowText)
        .join(condition.join === "any" ? " || " : " && ");
    default:
      return undefined;
  }
};

const FLIPPED: Partial<Record<ConditionTest, ConditionTest>> = {
  is: "isnt",
  isnt: "is",
  above: "atMost",
  atMost: "above",
  below: "atLeast",
  atLeast: "below",
  isTrue: "isFalse",
  isFalse: "isTrue",
};

/**
 * What holds when this doesn't: how an edge leaves a loop. `undefined` when
 * nothing does, as for a loop edge that's always taken.
 */
export const oppositeOf = (condition: Condition): string | undefined => {
  if (condition.mode === "succeeds" || condition.mode === "otherwise") {
    return undefined;
  }
  if (condition.mode === "fails") return "ok";
  if (condition.mode === "test" && condition.rows.length === 1) {
    const [row] = condition.rows;
    const test = row === undefined ? undefined : FLIPPED[row.test];
    if (row !== undefined && test !== undefined)
      return rowText({ ...row, test });
  }
  return `!(${String(conditionText(condition))})`;
};
