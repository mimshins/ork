/**
 * @file Reading a `when:` as choices (RFC-010): whether it's one of the shapes
 *   the builder can show as rows, and which. Anything else stays as the author
 *   wrote it.
 */

import { type Expr, parseExpr } from "./parse.ts";

export type ConditionValue = string | number | boolean;

export type ConditionTest =
  | "is"
  | "isnt"
  | "above"
  | "atLeast"
  | "below"
  | "atMost"
  | "contains"
  | "anyIs"
  | "allAre"
  | "isTrue"
  | "isFalse";

export type ConditionRow = {
  field: string;
  test: ConditionTest;
  value?: ConditionValue;
};

export type Condition =
  | { mode: "succeeds" }
  | { mode: "fails" }
  | { mode: "otherwise" }
  | { mode: "test"; join: "all" | "any"; rows: readonly ConditionRow[] }
  | { mode: "hand"; text: string };

const OPERATORS: Readonly<Record<string, ConditionTest>> = {
  "==": "is",
  "!=": "isnt",
  ">": "above",
  ">=": "atLeast",
  "<": "below",
  "<=": "atMost",
};

const CALLS: Readonly<Record<string, ConditionTest>> = {
  any: "anyIs",
  all: "allAre",
  contains: "contains",
};

/** A field of the edge's own source, as a bare name reads it. */
const fieldOf = (expr: Expr | undefined): string | null => {
  if (expr?.kind !== "path") return null;
  const segments =
    expr.segments[0] === "output" ? expr.segments.slice(1) : expr.segments;
  const [root] = segments;
  if (
    root === undefined ||
    root === "nodes" ||
    root === "inputs" ||
    root === "run" ||
    segments.some(segment => typeof segment !== "string")
  ) {
    return null;
  }
  return segments.join(".");
};

const valueOf = (expr: Expr | undefined): ConditionValue | null =>
  expr?.kind === "literal" && expr.value !== null ? expr.value : null;

const rowOf = (expr: Expr): ConditionRow | null => {
  if (expr.kind === "not") {
    const field = fieldOf(expr.operand);
    return field === null ? null : { field, test: "isFalse" };
  }
  if (expr.kind === "path") {
    const field = fieldOf(expr);
    return field === null ? null : { field, test: "isTrue" };
  }
  if (expr.kind === "call") {
    const test = CALLS[expr.name];
    const field = fieldOf(expr.args[0]);
    const value = valueOf(expr.args[1]);
    return test === undefined ||
      field === null ||
      value === null ||
      expr.args.length !== 2
      ? null
      : { field, test, value };
  }
  if (expr.kind !== "binary") return null;
  const test = OPERATORS[expr.op];
  const field = fieldOf(expr.left);
  const value = valueOf(expr.right);
  return test === undefined || field === null || value === null
    ? null
    : { field, test, value };
};

/** The leaves under one operator; another mixed in is left as a leaf. */
const leavesOf = (expr: Expr, op: "&&" | "||"): Expr[] =>
  expr.kind === "binary" && expr.op === op
    ? [...leavesOf(expr.left, op), ...leavesOf(expr.right, op)]
    : [expr];

/** What a `when:` is, as the builder can show it. */
export const readCondition = (when?: string): Condition => {
  if (when === undefined) return { mode: "succeeds" };
  const hand: Condition = { mode: "hand", text: when };
  const parsed = parseExpr(when);
  if (!parsed.ok) return hand;
  const { expr } = parsed;
  if (expr.kind === "literal" && expr.value === true) {
    return { mode: "otherwise" };
  }
  if (
    expr.kind === "not" &&
    expr.operand.kind === "path" &&
    expr.operand.segments.join(".") === "ok"
  ) {
    return { mode: "fails" };
  }
  const join = expr.kind === "binary" && expr.op === "||" ? "any" : "all";
  const rows = leavesOf(expr, join === "any" ? "||" : "&&").map(leaf =>
    rowOf(leaf),
  );
  return rows.every(row => row !== null) ? { mode: "test", join, rows } : hand;
};
