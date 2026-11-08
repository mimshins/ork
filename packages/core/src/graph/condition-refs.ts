/**
 * @file Reference checks on conditions and on what a node sends when it
 *   finishes: an edge's `when:`, a `watch.until`, and a `notify:` rule's
 *   `when:` and body.
 */

import type { Diagnostic, DiagnosticPath, Workflow } from "@krapht/ork-schema";

import { collectPaths, type Expr } from "../expr/parse.ts";
import type { CompiledRule } from "./notify.ts";
import { checkAbsolute, type Context } from "./ref-paths.ts";
import { checkOwn, checkTemplate } from "./templates.ts";
import { type CompiledEdge, itemNodeOf } from "./types.ts";
import { compileWatches } from "./watch.ts";

export type NotifyRules = ReadonlyMap<string, readonly CompiledRule[]>;

const checkCondition = (
  from: string,
  path: DiagnosticPath,
  condition: Expr,
  context: Context,
  extra: readonly string[] = [],
): Diagnostic[] => {
  return collectPaths(condition).flatMap(segments => {
    const [root] = segments;
    if (root === "run") return [];
    if (root === "inputs" || root === "nodes") {
      return checkAbsolute(segments, context, path);
    }
    return checkOwn(from, path, segments, context, extra);
  });
};

/** The context for `until:`: each item of a fanned node waits on its own look. */
const asItems = (context: Context, id: string): Context => {
  const node = context.workflow.nodes[id];
  return node === undefined
    ? context
    : {
        ...context,
        workflow: {
          ...context.workflow,
          nodes: { ...context.workflow.nodes, [id]: itemNodeOf(node) },
        },
      };
};

/** Checks every condition and every `notify:` rule against the workflow. */
export const checkConditionRefs = (
  workflow: Workflow,
  edges: readonly CompiledEdge[],
  rules: NotifyRules,
  context: Context,
): Diagnostic[] => {
  const fromRules = [...rules].flatMap(([id, compiled]) =>
    compiled.flatMap((rule, index) => [
      ...(rule.bodySource === undefined
        ? []
        : checkTemplate(
            id,
            ["notify", index, "body"],
            rule.bodySource,
            context,
            { own: ["ok", "error"] },
          )),
      ...(rule.condition === undefined
        ? []
        : checkCondition(
            id,
            ["nodes", id, "notify", index, "when"],
            rule.condition,
            context,
            ["ok", "error"],
          )),
    ]),
  );
  const fromConditions = edges.flatMap(edge =>
    edge.condition === undefined
      ? []
      : checkCondition(
          edge.from,
          ["edges", edge.source, "when"],
          edge.condition,
          context,
          ["ok"],
        ),
  );
  const fromWatches = compileWatches(workflow.nodes);
  const fromUntil = fromWatches.conditions.flatMap(({ id, condition }) =>
    checkCondition(
      id,
      ["nodes", id, "watch", "until"],
      condition,
      asItems(context, id),
      ["ok"],
    ),
  );
  return [
    ...fromConditions,
    ...fromRules,
    ...fromWatches.diagnostics,
    ...fromUntil,
  ];
};
