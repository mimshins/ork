/**
 * @file Checking one template: every input, node and field it reads must exist
 *   and run first, with what it may read depending on where it is. A `prompt`
 *   also reads its node's `before:`, a body its own result, and a program's
 *   `env:` the user's variables.
 */

import type {
  Diagnostic,
  DiagnosticPath,
  Step,
  Workflow,
} from "@krapht/ork-schema";

import { parseTemplate, SCOPE_ROOTS } from "../expr/evaluate.ts";
import { collectPaths } from "../expr/parse.ts";
import { error, warning } from "./diagnostics.ts";
import { ancestorsOf } from "./flow.ts";
import {
  checkAbsolute,
  checkField,
  type Context,
  describePath,
  envOutsideEnv,
} from "./ref-paths.ts";
import { ownersOf } from "./tree.ts";
import { outputFieldsOf, TOOL_OUTPUT_FIELDS } from "./types.ts";

/** A bare name or `output.*`, read from the node's own output. */
export const checkOwn = (
  from: string,
  path: DiagnosticPath,
  segments: readonly (string | number)[],
  context: Context,
  extra: readonly string[],
): Diagnostic[] => {
  const [root] = segments;
  const source = context.workflow.nodes[from];
  if (source === undefined) return [];
  // Only a prompt has it: anywhere else it would read as nothing, and compare.
  if (root === "before") {
    return [
      error(
        "ref.before",
        `\`${describePath(segments)}\`: what a \`before:\` step gave is read only in its node's prompt; a field of this name reads as \`output.before\``,
        path,
      ),
    ];
  }
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

export const checkTemplate = (
  id: string,
  at: string | readonly (string | number)[],
  text: string,
  context: Context,
  reads: {
    env?: boolean;
    own?: readonly string[];
    /** What this node's `before:` reports; only its prompt reads it. */
    before?: readonly string[];
    /** For `defaults:`, which belongs to no node and sees no other's output. */
    path?: DiagnosticPath;
  } = {},
): Diagnostic[] => {
  const path: DiagnosticPath = reads.path ?? ["nodes", id, ...[at].flat()];
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
      if (root === "before" && reads.before !== undefined) {
        return name === undefined || reads.before.includes(String(name))
          ? []
          : [
              error(
                "ref.before",
                `\`${describePath(segments)}\`: a \`before:\` step reports \`${reads.before.join("`, `")}\``,
                path,
              ),
            ];
      }
      if (root === "nodes" && reads.path !== undefined) {
        return [
          error(
            "template.scope",
            `\`${describePath(segments)}\`: defaults run for every node, so they can't read a node's output`,
            path,
          ),
        ];
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
            `\`${describePath(segments)}\`: templates read \`inputs.*\`, \`nodes.<id>.output.*\` or \`run.*\`, and a tool node's \`env:\` also reads \`env.*\``,
            path,
          ),
        ];
      }
      const found = checkAbsolute(segments, context, path);
      if (
        found.every(({ code }) => code === "ref.undeclared") &&
        root === "nodes" &&
        name !== id &&
        !upstream.has(String(name))
      ) {
        found.push(
          warning(
            "template.not-upstream",
            `\`${describePath(segments)}\`: \`${String(name)}\` does not run before \`${id}\`, so its output may be missing`,
            path,
          ),
        );
      }
      return found;
    });
  });
};

export const beforeFields = (before: Step): readonly string[] => [
  ...TOOL_OUTPUT_FIELDS,
  ...(before.output?.format === "json" ? ["json"] : []),
];

export const checkDefaultsBefore = (
  workflow: Workflow,
  context: Context,
): Diagnostic[] => {
  const before = workflow.defaults?.before;
  if (before === undefined) return [];
  const at = ["defaults", "before"];
  return [
    ...Object.entries(before.env ?? {}).flatMap(([name, value]) =>
      checkTemplate("", "", value, context, {
        env: true,
        path: [...at, "env", name],
      }),
    ),
    ...(before.command === undefined
      ? []
      : checkTemplate("", "", before.command, context, {
          path: [...at, "command"],
        })),
  ];
};
