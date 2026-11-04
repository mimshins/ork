/**
 * @file Reference checks: every input, node and field a template or condition
 *   reads must exist and run first.
 */

import {
  type Diagnostic,
  type DiagnosticPath,
  isToolNode,
  type Workflow,
} from "@krapht/ork-schema";

import { parseTemplate, SCOPE_ROOTS } from "../expr/evaluate.ts";
import { collectPaths, type Expr } from "../expr/parse.ts";
import { error, warning } from "./diagnostics.ts";
import { checkToolEnv } from "./env.ts";
import { ancestorsOf } from "./flow.ts";
import type { CompiledRule } from "./notify.ts";
import {
  checkAbsolute,
  checkField,
  type Context,
  describePath,
  envOutsideEnv,
} from "./ref-paths.ts";
import { ownersOf } from "./tree.ts";
import { type CompiledEdge, outputFieldsOf } from "./types.ts";

const TEMPLATE_FIELDS = [
  "prompt",
  "instructions",
  "command",
  "cwd",
  "question",
  "workflow",
  "project",
  "ref",
] as const;

/** A bare name or `output.*`, read from the node's own output. */
const checkOwn = (
  from: string,
  path: DiagnosticPath,
  segments: readonly (string | number)[],
  context: Context,
  extra: readonly string[],
): Diagnostic[] => {
  const [root] = segments;
  const source = context.workflow.nodes[from];
  if (source === undefined) return [];
  // A node may report a field called `env`; otherwise it means the user's.
  if (root === "env" && outputFieldsOf(source)?.includes("env") === false) {
    return [envOutsideEnv(segments, path)];
  }
  const relative = root === "output" ? segments.slice(1) : segments;
  const roots: readonly (string | number)[] = [...SCOPE_ROOTS, ...extra];
  return roots.includes(String(relative[0]))
    ? []
    : checkField(source, relative[0], segments, path);
};

const checkTemplate = (
  id: string,
  at: string | readonly (string | number)[],
  text: string,
  context: Context,
  reads: { env?: boolean; own?: readonly string[] } = {},
): Diagnostic[] => {
  const path: DiagnosticPath = ["nodes", id, ...[at].flat()];
  const parsed = parseTemplate(text);
  if (!parsed.ok) {
    return [
      error(
        "template.syntax",
        `${parsed.message} at column ${parsed.offset + 1}`,
        path,
      ),
    ];
  }
  // A node can read its own ancestors and those of every owner above it.
  const upstream = ancestorsOf(id, context.edges);
  for (const owner of ownersOf(context.workflow, id)) {
    upstream.add(owner);
    for (const ancestor of ancestorsOf(owner, context.edges)) {
      upstream.add(ancestor);
    }
  }
  return parsed.parts.flatMap(part => {
    if (typeof part === "string") return [];
    return collectPaths(part.expr).flatMap(segments => {
      const [root, name] = segments;
      if (root === "run") return [];
      if (root === "env" && reads.env === true) {
        return name === undefined
          ? [error("template.env", "name a variable: env.NAME", path)]
          : [];
      }
      if (root === "env" && reads.own === undefined) {
        return [envOutsideEnv(segments, path)];
      }
      if (root !== "inputs" && root !== "nodes") {
        if (reads.own !== undefined) {
          return checkOwn(id, path, segments, context, reads.own);
        }
        return [
          error(
            "template.scope",
            `"${describePath(segments)}": templates read inputs.*, nodes.<id>.output.* or run.*, and a tool node's env: also reads env.*`,
            path,
          ),
        ];
      }
      const found = checkAbsolute(segments, context, path);
      if (
        found.length === 0 &&
        root === "nodes" &&
        name !== id &&
        !upstream.has(String(name))
      ) {
        found.push(
          warning(
            "template.not-upstream",
            `"${describePath(segments)}": "${String(name)}" does not run before "${id}", so its output may be missing`,
            path,
          ),
        );
      }
      return found;
    });
  });
};

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

/** Checks every template and `when:` against the workflow. */
export const checkReferences = (
  workflow: Workflow,
  edges: readonly CompiledEdge[],
  rules: ReadonlyMap<string, readonly CompiledRule[]> = new Map(),
): Diagnostic[] => {
  const context: Context = { workflow, edges };
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
  const fromTemplates = Object.entries(workflow.nodes).flatMap(([id, node]) =>
    TEMPLATE_FIELDS.flatMap(field => {
      const value: unknown = Reflect.get(node, field);
      return typeof value === "string"
        ? checkTemplate(id, field, value, context)
        : [];
    }),
  );
  const fromCalls = Object.entries(workflow.nodes).flatMap(([id, node]) =>
    node.type === "workflow.call"
      ? Object.entries(node.inputs ?? {}).flatMap(([name, value]) =>
          checkTemplate(id, `inputs.${name}`, value, context),
        )
      : [],
  );
  const fromEnv = Object.entries(workflow.nodes).flatMap(([id, node]) =>
    isToolNode(node)
      ? Object.entries(node.env ?? {}).flatMap(([name, value]) =>
          checkTemplate(id, `env.${name}`, value, context, { env: true }),
        )
      : [],
  );
  const fromOutputs = Object.entries(workflow.outputs ?? {}).flatMap(
    ([name, value]) => {
      const parsed = parseTemplate(value);
      const path = ["outputs", name];
      if (!parsed.ok) {
        return [error("template.syntax", parsed.message, path)];
      }
      return parsed.parts.flatMap(part =>
        typeof part === "string"
          ? []
          : collectPaths(part.expr).flatMap(segments =>
              segments[0] === "env"
                ? [envOutsideEnv(segments, path)]
                : checkAbsolute(segments, context, path),
            ),
      );
    },
  );
  const fromConditions = edges.flatMap(edge =>
    edge.condition === undefined
      ? []
      : checkCondition(
          edge.from,
          ["edges", edge.source, "when"],
          edge.condition,
          context,
        ),
  );
  return [
    ...fromTemplates,
    ...fromCalls,
    ...fromEnv,
    ...checkToolEnv(workflow),
    ...fromOutputs,
    ...fromConditions,
    ...fromRules,
  ];
};
