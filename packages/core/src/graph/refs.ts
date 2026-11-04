/**
 * @file Reference checks: every input, node and field a template or condition
 *   reads must exist and run first.
 */

import {
  beforeOf,
  type Diagnostic,
  type DiagnosticPath,
  isToolNode,
  programsOf,
  type Workflow,
} from "@krapht/ork-schema";

import { parseTemplate } from "../expr/evaluate.ts";
import { collectPaths, type Expr } from "../expr/parse.ts";
import { error } from "./diagnostics.ts";
import { checkToolEnv } from "./env.ts";
import type { CompiledRule } from "./notify.ts";
import { checkAbsolute, type Context, envOutsideEnv } from "./ref-paths.ts";
import {
  beforeFields,
  checkDefaultsBefore,
  checkOwn,
  checkTemplate,
} from "./templates.ts";
import type { CompiledEdge } from "./types.ts";

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

/** Every string under a value, and where it is: an MCP call's templates. */
const stringsIn = (
  value: unknown,
  at: readonly (string | number)[],
): { at: readonly (string | number)[]; text: string }[] => {
  if (typeof value === "string") return [{ at, text: value }];
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, item]) =>
    stringsIn(item, [...at, key]),
  );
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
      const before = beforeOf(node, workflow.defaults);
      const reads =
        field === "prompt" && before !== undefined
          ? { before: beforeFields(before) }
          : {};
      return typeof value === "string"
        ? checkTemplate(id, field, value, context, reads)
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
    programsOf(node).flatMap(({ at, program }) =>
      Object.entries(program.env ?? {}).flatMap(([name, value]) =>
        checkTemplate(id, [...at, "env", name], value, context, { env: true }),
      ),
    ),
  );
  const fromMcp = Object.entries(workflow.nodes).flatMap(([id, node]) =>
    node.type === "mcp.call"
      ? stringsIn(node.arguments ?? {}, ["arguments"]).flatMap(({ at, text }) =>
          checkTemplate(id, at, text, context),
        )
      : [],
  );
  const fromSteps = Object.entries(workflow.nodes).flatMap(([id, node]) =>
    isToolNode(node)
      ? []
      : programsOf(node).flatMap(({ at, program }) =>
          program.command === undefined
            ? []
            : checkTemplate(id, [...at, "command"], program.command, context),
        ),
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
          ["ok"],
        ),
  );
  const fromDefaults = checkDefaultsBefore(workflow, context);
  return [
    ...fromDefaults,
    ...fromTemplates,
    ...fromCalls,
    ...fromEnv,
    ...fromSteps,
    ...fromMcp,
    ...checkToolEnv(workflow),
    ...fromOutputs,
    ...fromConditions,
    ...fromRules,
  ];
};
