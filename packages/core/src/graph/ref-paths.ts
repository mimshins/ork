/**
 * @file The reference checks on one path in a template or condition: an input,
 *   a node's report and its field, and the user's variables outside `env:`.
 */

import {
  type Diagnostic,
  type DiagnosticPath,
  isToolNode,
  type Node,
  type Workflow,
} from "@krapht/ork-schema";

import { error, warning } from "./diagnostics.ts";
import {
  type CompiledEdge,
  declaredOutputOf,
  forEachOf,
  outputFieldsOf,
} from "./types.ts";

export type Context = {
  workflow: Workflow;
  edges: readonly CompiledEdge[];
};

export const describePath = (segments: readonly (string | number)[]) =>
  segments.join(".");

/** Checks `inputs.*` and `nodes.<id>.output.*` references. */
export const checkAbsolute = (
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
            `\`${describePath(segments)}\` reads an input the workflow does not declare`,
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
          `\`${describePath(segments)}\` reads an unknown node`,
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

export const checkField = (
  target: Node,
  field: string | number | undefined,
  segments: readonly (string | number)[],
  path: DiagnosticPath,
): Diagnostic[] => {
  const known = outputFieldsOf(target);
  if (field === undefined || known === null) return [];
  if (forEachOf(target) !== undefined && !known.includes(String(field))) {
    return [
      error(
        "ref.field",
        `\`${describePath(segments)}\`: \`forEach\` makes this node report \`${known.join("`, `")}\`, not its type's fields; read one item's under \`results\``,
        path,
      ),
    ];
  }
  if (field === "json" && isToolNode(target) && !known.includes("json")) {
    return [
      error(
        "ref.json",
        `\`${describePath(segments)}\`: this tool node has no JSON result; give it \`output: { format: json }\``,
        path,
      ),
    ];
  }
  if (!known.includes(String(field))) {
    return [
      warning(
        "ref.field",
        `\`${describePath(segments)}\`: a \`${target.type}\` reports \`${known.join("`, `")}\``,
        path,
      ),
    ];
  }
  return field === "json" ? checkDeclared(target, segments, path) : [];
};

/** A field of a tool's JSON that nothing says will be there (RFC-010). */
const checkDeclared = (
  target: Node,
  segments: readonly (string | number)[],
  path: DiagnosticPath,
): Diagnostic[] => {
  const name = segments[segments.indexOf("json") + 1];
  if (name === undefined || declaredOutputOf(target)?.[name] !== undefined) {
    return [];
  }
  return [
    warning(
      "ref.undeclared",
      `\`${describePath(segments)}\`: nothing declares \`${String(name)}\`; add it to this node's \`output.schema\`, so a run checks it`,
      path,
    ),
  ];
};

/** Only `env:` may read the user's variables: a rendered command is recorded. */
export const envOutsideEnv = (
  segments: readonly (string | number)[],
  path: DiagnosticPath,
): Diagnostic =>
  error(
    "template.env",
    `\`${describePath(segments)}\`: only a tool node's \`env:\` may read the user's variables, so a secret never reaches a recorded command`,
    path,
  );
