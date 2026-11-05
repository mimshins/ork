/**
 * @file The checks on what a condition compares (RFC-009): a value its source
 *   can't have is an error, and a condition that reads nothing and is false is
 *   a warning. The values come from what each node says (`says.ts`), which the
 *   builder's choices read too, so the two can't disagree.
 */

import type { Diagnostic, Workflow } from "@krapht/ork-schema";

import { evaluate, truthy } from "../expr/evaluate.ts";
import { collectPaths, type Expr } from "../expr/parse.ts";
import { error, warning } from "./diagnostics.ts";
import type { CompiledRule } from "./notify.ts";
import { nodeSays, type NodeSays } from "./says.ts";
import type { CompiledEdge } from "./types.ts";

/**
 * What a condition that reads nothing comes to, or `null` if it reads
 * something.
 */
const constantOf = (condition: Expr): boolean | null =>
  collectPaths(condition).length > 0
    ? null
    : truthy(evaluate(condition, { inputs: {}, nodes: {} }));

/** Whether an edge's condition can't hold it back: none, or always true. */
export const alwaysHolds = ({ condition }: CompiledEdge): boolean =>
  condition === undefined || constantOf(condition) === true;

export type FieldRead = { id: string; field: string };

/** Which node's field a path reads; `own` is the node a bare name means. */
export const fieldRead = (
  expr: Expr | undefined,
  own: string,
): FieldRead | null => {
  if (expr?.kind !== "path") return null;
  const { segments } = expr;
  if (segments.some(segment => typeof segment !== "string")) return null;
  const [root, id, output] = segments;
  if (root === "nodes") {
    return output === "output" && typeof id === "string"
      ? { id, field: segments.slice(3).join(".") }
      : null;
  }
  if (root === "inputs" || root === "run" || root === "env") return null;
  const field = root === "output" ? segments.slice(1) : segments;
  return { id: own, field: field.join(".") };
};

const literalOf = (expr: Expr | undefined): string | number | boolean | null =>
  expr?.kind === "literal" ? expr.value : null;

type Comparison = {
  read: FieldRead;
  value: string | number | boolean;
  /** How the field holds its values: one, or a list of them. */
  kind: "values" | "statuses";
};

const LIST_CALLS: ReadonlySet<string> = new Set([
  "any",
  "all",
  "count",
  "contains",
]);

/** The one comparison this expression makes, if it makes one. */
const comparisonAt = (expr: Expr, own: string): Comparison | null => {
  if (expr.kind === "call" && LIST_CALLS.has(expr.name)) {
    const read = fieldRead(expr.args[0], own);
    const value = literalOf(expr.args[1]);
    return read === null || value === null
      ? null
      : { read, value, kind: "statuses" };
  }
  if (expr.kind !== "binary" || (expr.op !== "==" && expr.op !== "!=")) {
    return null;
  }
  const read = fieldRead(expr.left, own) ?? fieldRead(expr.right, own);
  const value = literalOf(expr.left) ?? literalOf(expr.right);
  return read === null || value === null
    ? null
    : { read, value, kind: "values" };
};

/** Every comparison in a condition, through `&&`, `||` and `!`. */
const comparisonsIn = (expr: Expr, own: string): Comparison[] => {
  if (expr.kind === "not") return comparisonsIn(expr.operand, own);
  const here = comparisonAt(expr, own);
  if (here !== null) return [here];
  return expr.kind === "binary"
    ? [...comparisonsIn(expr.left, own), ...comparisonsIn(expr.right, own)]
    : [];
};

const shown = (value: string | number | boolean): string =>
  `\`${String(value)}\``;

const listed = (values: readonly (string | number | boolean)[]): string => {
  const names = values.map(value => shown(value));
  const last = names.pop();
  return names.length === 0
    ? String(last)
    : `${names.join(", ")} or ${String(last)}`;
};

/** A `when.value` for each thing this condition compares that can't be. */
const valueProblems = (
  condition: Expr,
  own: string,
  says: Readonly<Record<string, NodeSays>>,
  path: (string | number)[],
): Diagnostic[] =>
  comparisonsIn(condition, own).flatMap(({ read, value, kind }) => {
    const said = says[read.id]?.fields.find(
      ({ field }) => field === read.field,
    );
    if (said?.values === undefined || said.open === true) return [];
    if (said.kind !== kind || said.values.includes(value)) return [];
    return [
      error(
        "when.value",
        `\`${read.field}\` of \`${read.id}\` is never ${shown(value)}: it can be ${listed(said.values)}`,
        path,
      ),
    ];
  });

/**
 * Every edge's and rule's condition, checked against what its source can say. A
 * `watch.until` has its own check (`watch.value`).
 */
export const checkConditions = (
  workflow: Workflow,
  edges: readonly CompiledEdge[],
  rules: ReadonlyMap<string, readonly CompiledRule[]>,
): Diagnostic[] => {
  const says = nodeSays(workflow.nodes, edges);
  const onEdges = edges.flatMap(edge => {
    const { condition } = edge;
    if (condition === undefined) return [];
    const path = ["edges", edge.source, "when"];
    return [
      ...valueProblems(condition, edge.from, says, path),
      ...(constantOf(condition) === false
        ? [
            warning(
              "when.never",
              `\`${edge.from} -> ${edge.to}\` is never taken: its condition is always false`,
              path,
            ),
          ]
        : []),
    ];
  });
  const onRules = [...rules].flatMap(([id, compiled]) =>
    compiled.flatMap(({ condition }, index) =>
      condition === undefined
        ? []
        : valueProblems(condition, id, says, [
            "nodes",
            id,
            "notify",
            index,
            "when",
          ]),
    ),
  );
  return [...onEdges, ...onRules];
};
