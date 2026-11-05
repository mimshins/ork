/**
 * @file What a workflow's conditions read of each node (RFC-009): a walk tries
 *   each literal a field is compared with and a value that isn't it, a number
 *   either side of a bound, and a text that does and doesn't contain a given
 *   one. A router or split passes its input through, and a join reports its
 *   inputs' statuses, so what they're asked goes to the nodes before them.
 */

import { type Expr, parseExpr } from "../expr/parse.ts";
import { type FieldRead, fieldRead } from "../graph/condition-checks.ts";
import type { CompiledGraph } from "../graph/types.ts";

type Literal = string | number | boolean | null;

/** Node id, then the field a condition reads, then the values to try. */
export type Reads = ReadonlyMap<
  string,
  ReadonlyMap<string, readonly unknown[]>
>;

type Wanted = { read: FieldRead; values: readonly unknown[] };

const otherThan = (value: Literal): unknown => {
  if (typeof value === "boolean") return !value;
  if (typeof value === "number") return value + 1;
  return value === null ? "other" : `${value}-other`;
};

const eitherSide = (value: Literal): readonly unknown[] => {
  if (typeof value === "number") return [value - 1, value, value + 1];
  return typeof value === "string" ? [value, `${value}~`, ""] : [value];
};

const wantedAt = (
  path: Expr | undefined,
  own: string,
  values: readonly unknown[],
): Wanted[] => {
  const read = fieldRead(path, own);
  return read === null ? [] : [{ read, values }];
};

const inCall = (expr: Expr & { kind: "call" }, own: string): Wanted[] => {
  const [subject, operand] = expr.args;
  const value = operand?.kind === "literal" ? operand.value : undefined;
  if (expr.name === "len") return [];
  if (expr.name === "contains") {
    if (value === undefined) return [];
    return wantedAt(
      subject,
      own,
      typeof value === "string" ? [value, ""] : [[value], []],
    );
  }
  if (operand === undefined) return wantedAt(subject, own, [[true], []]);
  return value === undefined
    ? []
    : wantedAt(subject, own, [[value], [otherThan(value)]]);
};

/** The field and literal a comparison sets against each other, if it does. */
const compared = (
  left: Expr,
  right: Expr,
): { path: Expr; value: Literal } | null => {
  if (left.kind === "path" && right.kind === "literal") {
    return { path: left, value: right.value };
  }
  return right.kind === "path" && left.kind === "literal"
    ? { path: right, value: left.value }
    : null;
};

const wantedIn = (expr: Expr, own: string): Wanted[] => {
  switch (expr.kind) {
    case "path": {
      return wantedAt(expr, own, [true, false]);
    }
    case "not": {
      return wantedIn(expr.operand, own);
    }
    case "call": {
      return inCall(expr, own);
    }
    case "binary": {
      const pair =
        expr.op === "&&" || expr.op === "||"
          ? null
          : compared(expr.left, expr.right);
      if (pair === null) {
        return [...wantedIn(expr.left, own), ...wantedIn(expr.right, own)];
      }
      const exact = expr.op === "==" || expr.op === "!=";
      return wantedAt(
        pair.path,
        own,
        exact ? [pair.value, otherThan(pair.value)] : eitherSide(pair.value),
      );
    }
    case "literal": {
      return [];
    }
    default: {
      return [];
    }
  }
};

const sameValue = (one: unknown, other: unknown): boolean =>
  JSON.stringify(one) === JSON.stringify(other);

/** Adds values a list doesn't have yet, keeping the order they came in. */
export const withValues = (
  list: readonly unknown[],
  values: readonly unknown[],
): unknown[] => {
  const merged = [...list];
  for (const value of values) {
    if (!merged.some(other => sameValue(other, value))) merged.push(value);
  }
  return merged;
};

const REPORTS_INPUTS = /^(?:statuses|results)(?:\.|$)/u;

/** What a join is asked about its inputs, as values of their `status`. */
const statusesIn = (values: readonly unknown[]): unknown[] =>
  values.flat().filter(value => typeof value === "string");

export const readsOf = (graph: CompiledGraph): Reads => {
  const reads = new Map<string, Map<string, unknown[]>>();

  const attach = (
    id: string,
    field: string,
    values: readonly unknown[],
    seen: Set<string>,
  ): void => {
    const compiled = graph.nodes.get(id);
    if (compiled === undefined || seen.has(id)) return;
    seen.add(id);
    const { type } = compiled.node;
    if (type === "control.router" || type === "control.split") {
      // A loop edge into one brings its source's output too.
      for (const { from } of compiled.incoming) {
        attach(from, field, values, seen);
      }
    } else if (type === "control.join") {
      if (!REPORTS_INPUTS.test(field)) return;
      const inputs = compiled.incoming
        .filter(({ maxRounds }) => maxRounds === undefined)
        .map(({ from }) => from);
      for (const input of inputs) {
        attach(input, "status", statusesIn(values), seen);
      }
    } else {
      const fields = reads.get(id) ?? new Map<string, unknown[]>();
      reads.set(id, fields);
      fields.set(field, withValues(fields.get(field) ?? [], values));
    }
  };

  const add = (expr: Expr, own: string): void => {
    for (const { read, values } of wantedIn(expr, own)) {
      // How it ended is tried anyway, and isn't a field of its output.
      if (read.field !== "" && read.field !== "ok") {
        attach(read.id, read.field, values, new Set());
      }
    }
  };

  for (const { condition, from } of graph.edges) {
    if (condition !== undefined) add(condition, from);
  }
  for (const [id, { node }] of graph.nodes) {
    const until = "watch" in node ? node.watch?.until : undefined;
    const parsed = until === undefined ? null : parseExpr(until);
    if (parsed?.ok === true) add(parsed.expr, id);
  }
  return reads;
};
