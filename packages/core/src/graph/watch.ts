/**
 * @file Checking a `watch:` (RFC-011). A wait only ends when its condition can
 *   hold, so one that can't is refused before the run, rather than found out at
 *   its timeout: a value or a field the node doesn't declare, a wait for it to
 *   fail, which ends a wait anyway, or a test only of what a tested look always
 *   says.
 */

import { type Diagnostic, isToolNode, type Node } from "@krapht/ork-schema";

import { readCondition } from "../expr/condition.ts";
import { evaluate, truthy } from "../expr/evaluate.ts";
import { collectPaths, type Expr, parseExpr } from "../expr/parse.ts";
import { error } from "./diagnostics.ts";
import { nodeSays } from "./says.ts";
import { declaredOutputOf } from "./types.ts";

/** What every look that gets tested says: a failed one isn't tested. */
const ALWAYS_SAID: ReadonlySet<string | number | undefined> = new Set([
  "ok",
  "exitCode",
  "error",
]);

const localPath = (segments: readonly (string | number)[]) =>
  segments[0] === "output" ? segments.slice(1) : segments;

/** A condition that reads nothing that can change, and is false as it stands. */
const neverHolds = (id: string, node: Node, expr: Expr): Diagnostic[] => {
  const reads = collectPaths(expr).map(segments => localPath(segments));
  if (reads.some(([root]) => !ALWAYS_SAID.has(root))) return [];
  const look = { ok: true, ...(isToolNode(node) ? { exitCode: 0 } : {}) };
  return truthy(evaluate(expr, { inputs: {}, nodes: {}, output: look }))
    ? []
    : [
        error(
          "watch.until",
          `${id} waits for something a look can't say: a failed look isn't tested, so every tested one has ok true and exit code 0. Say what a look reports instead`,
          ["nodes", id, "watch", "until"],
        ),
      ];
};

/** A field the node declares it doesn't say, which would wait for nothing. */
const fieldProblems = (id: string, node: Node, expr: Expr): Diagnostic[] => {
  const declared = declaredOutputOf(node);
  if (declared === undefined) return [];
  const missing = collectPaths(expr)
    .map(segments => localPath(segments))
    .filter(([root, name]) => root === "json" && name !== undefined)
    .map(([, name]) => String(name))
    .filter(name => !Object.hasOwn(declared, name));
  return [...new Set(missing)].map(name =>
    error(
      "watch.field",
      `${id} waits on json.${name}, which it never says: it declares ${Object.keys(declared).join(", ")}`,
      ["nodes", id, "watch", "until"],
    ),
  );
};

/** Whether a test against this value can ever hold, by what's declared. */
const valueProblems = (id: string, node: Node, when: string): Diagnostic[] => {
  const condition = readCondition(when);
  const path = ["nodes", id, "watch", "until"];
  if (condition.mode === "fails") {
    return [
      error(
        "watch.until",
        `${id} waits for itself to fail, but a failed look is tried again, and then ends the wait; say what a look reports instead`,
        path,
      ),
    ];
  }
  if (condition.mode !== "test") return [];
  const { fields } = nodeSays({ [id]: node }, [])[id] ?? { fields: [] };
  return condition.rows.flatMap(({ field, test, value }) => {
    const said = fields.find(item => item.field === field);
    if (
      test !== "is" ||
      said?.kind !== "values" ||
      value === undefined ||
      said.values?.includes(value) !== false
    ) {
      return [];
    }
    return [
      error(
        "watch.value",
        `\`${id}\` waits for \`${field}\` to be \`${String(value)}\`, which it never says: it declares \`${(said.values ?? []).join("`, `")}\``,
        path,
      ),
    ];
  });
};

/** Every `until:` parsed, for the reference checks, and what's wrong with it. */
export const compileWatches = (
  nodes: Readonly<Record<string, Node>>,
): {
  conditions: { id: string; condition: Expr }[];
  diagnostics: Diagnostic[];
} => {
  const conditions: { id: string; condition: Expr }[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const [id, node] of Object.entries(nodes)) {
    const when = "watch" in node ? node.watch?.until : undefined;
    if (when === undefined) continue;
    const parsed = parseExpr(when);
    if (parsed.ok) {
      conditions.push({ id, condition: parsed.expr });
      const value = valueProblems(id, node, when);
      diagnostics.push(
        ...value,
        ...(value.length > 0 ? [] : neverHolds(id, node, parsed.expr)),
        ...fieldProblems(id, node, parsed.expr),
      );
    } else {
      diagnostics.push(
        error(
          "watch.until",
          `until: ${parsed.message} at column ${String(parsed.offset + 1)}`,
          ["nodes", id, "watch", "until"],
        ),
      );
    }
  }
  return { conditions, diagnostics };
};
