import type {
  Diagnostic,
  DiagnosticPath,
  Node,
  Workflow,
} from "@krapht/ork-schema";

import { parseTemplate, SCOPE_ROOTS } from "../expr/evaluate.ts";
import { collectPaths, type Expr } from "../expr/parse.ts";
import { error, warning } from "./diagnostics.ts";
import { ancestorsOf } from "./flow.ts";
import { ownersOf } from "./tree.ts";
import { type CompiledEdge, outputFieldsOf } from "./types.ts";

const TEMPLATE_FIELDS = [
  "prompt",
  "instructions",
  "command",
  "cwd",
  "question",
] as const;

type Context = {
  workflow: Workflow;
  edges: readonly CompiledEdge[];
};

const describePath = (segments: readonly (string | number)[]) =>
  segments.join(".");

/** Checks `inputs.*` and `nodes.<id>.output.*` references. */
const checkAbsolute = (
  segments: readonly (string | number)[],
  { workflow }: Context,
  path: DiagnosticPath,
): Diagnostic[] => {
  const [root, name, field] = segments;
  if (root === "inputs") {
    if (name === undefined) {
      return [error("ref.input", "name an input: inputs.<name>", path)];
    }
    return workflow.inputs?.[String(name)] === undefined
      ? [
          error(
            "ref.input",
            `"${describePath(segments)}" reads an input the workflow does not declare`,
            path,
          ),
        ]
      : [];
  }
  if (root === "nodes") {
    const target =
      name === undefined ? undefined : workflow.nodes[String(name)];
    if (target === undefined) {
      return [
        error(
          "ref.node",
          `"${describePath(segments)}" reads an unknown node`,
          path,
        ),
      ];
    }
    if (field !== "output") {
      return [
        error(
          "ref.node",
          `read a node's report as nodes.${String(name)}.output.<field>`,
          path,
        ),
      ];
    }
    return checkField(target, segments[3], segments, path);
  }
  return [];
};

const checkField = (
  target: Node,
  field: string | number | undefined,
  segments: readonly (string | number)[],
  path: DiagnosticPath,
): Diagnostic[] => {
  const known = outputFieldsOf(target);
  if (field === undefined || known === null) return [];
  return known.includes(String(field))
    ? []
    : [
        warning(
          "ref.field",
          `"${describePath(segments)}": a ${target.type} reports ${known.join(", ")}`,
          path,
        ),
      ];
};

const checkTemplate = (
  id: string,
  field: string,
  text: string,
  context: Context,
): Diagnostic[] => {
  const path = ["nodes", id, field];
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
      if (root !== "inputs" && root !== "nodes") {
        return [
          error(
            "template.scope",
            `"${describePath(segments)}": templates read inputs.*, nodes.<id>.output.* or run.*`,
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
  edge: CompiledEdge,
  condition: Expr,
  context: Context,
): Diagnostic[] => {
  const path = ["edges", edge.source, "when"];
  const source = context.workflow.nodes[edge.from];
  return collectPaths(condition).flatMap(segments => {
    const [root] = segments;
    if (root === "run") return [];
    if (root === "inputs" || root === "nodes") {
      return checkAbsolute(segments, context, path);
    }
    if (source === undefined) return [];
    const relative = root === "output" ? segments.slice(1) : segments;
    const roots: readonly (string | number)[] = SCOPE_ROOTS;
    return roots.includes(String(relative[0]))
      ? []
      : checkField(source, relative[0], segments, path);
  });
};

/** Checks every template and `when:` against the workflow. */
export const checkReferences = (
  workflow: Workflow,
  edges: readonly CompiledEdge[],
): Diagnostic[] => {
  const context: Context = { workflow, edges };
  const fromTemplates = Object.entries(workflow.nodes).flatMap(([id, node]) =>
    TEMPLATE_FIELDS.flatMap(field => {
      const value: unknown = Reflect.get(node, field);
      return typeof value === "string"
        ? checkTemplate(id, field, value, context)
        : [];
    }),
  );
  const fromConditions = edges.flatMap(edge =>
    edge.condition === undefined
      ? []
      : checkCondition(edge, edge.condition, context),
  );
  return [...fromTemplates, ...fromConditions];
};
