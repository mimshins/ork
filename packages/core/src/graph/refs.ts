/**
 * @file Reference checks: every input, node and field a template or condition
 *   reads must exist and run first.
 */

import {
  type Diagnostic,
  type DiagnosticPath,
  isToolNode,
  type Node,
  type Workflow,
} from "@krapht/ork-schema";

import { parseTemplate, SCOPE_ROOTS } from "../expr/evaluate.ts";
import { collectPaths, type Expr } from "../expr/parse.ts";
import { error, warning } from "./diagnostics.ts";
import { checkToolEnv } from "./env.ts";
import { ancestorsOf } from "./flow.ts";
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
  if (field === "json" && isToolNode(target) && !known.includes("json")) {
    return [
      error(
        "ref.json",
        `"${describePath(segments)}": this tool node has no JSON result; give it output: { format: json }`,
        path,
      ),
    ];
  }
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

/** Only `env:` may read the user's variables: a rendered command is recorded. */
const envOutsideEnv = (
  segments: readonly (string | number)[],
  path: DiagnosticPath,
): Diagnostic =>
  error(
    "template.env",
    `"${describePath(segments)}": only a tool node's env: may read the user's variables, so a secret never reaches a recorded command`,
    path,
  );

const checkTemplate = (
  id: string,
  field: string,
  text: string,
  context: Context,
  readsEnv = false,
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
      if (root === "env") {
        if (!readsEnv) return [envOutsideEnv(segments, path)];
        return name === undefined
          ? [error("template.env", "name a variable: env.NAME", path)]
          : [];
      }
      if (root !== "inputs" && root !== "nodes") {
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
    // A node may report a field called `env`; otherwise it means the user's.
    if (root === "env" && outputFieldsOf(source)?.includes("env") === false) {
      return [envOutsideEnv(segments, path)];
    }
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
          checkTemplate(id, `env.${name}`, value, context, true),
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
      : checkCondition(edge, edge.condition, context),
  );
  return [
    ...fromTemplates,
    ...fromCalls,
    ...fromEnv,
    ...checkToolEnv(workflow),
    ...fromOutputs,
    ...fromConditions,
  ];
};
