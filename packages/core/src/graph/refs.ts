/**
 * @file Reference checks: every input, node and field a template or condition
 *   reads must exist and run first.
 */

import {
  beforeOf,
  type Diagnostic,
  isToolNode,
  programsOf,
  type Workflow,
} from "@krapht/ork-schema";

import { parseTemplate } from "../expr/evaluate.ts";
import { collectPaths } from "../expr/parse.ts";
import { checkConditionRefs, type NotifyRules } from "./condition-refs.ts";
import { error } from "./diagnostics.ts";
import { checkToolEnv } from "./env.ts";
import { checkItemRead, isItemRoot, itemScopes } from "./for-each.ts";
import {
  checkAbsolute,
  type Context,
  describePath,
  envOutsideEnv,
} from "./ref-paths.ts";
import {
  beforeFields,
  checkDefaultsBefore,
  checkTemplate,
} from "./templates.ts";
import type { CompiledEdge } from "./types.ts";

const TEMPLATE_FIELDS = [
  "prompt",
  "instructions",
  "command",
  "cwd",
  "question",
  "document",
  "workflow",
  "project",
  "ref",
  "lock",
] as const;

/**
 * The templates of a node that may read `{{item}}`, beside `inputs`,
 * `arguments` and `env`.
 */
const ITEM_FIELDS = new Set(["prompt", "command", "ref"]);

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
  rules: NotifyRules = new Map(),
): Diagnostic[] => {
  const context: Context = { workflow, edges };
  const itemOf = itemScopes(workflow, edges);
  const fromTemplates = Object.entries(workflow.nodes).flatMap(([id, node]) =>
    TEMPLATE_FIELDS.flatMap(field => {
      const value: unknown = Reflect.get(node, field);
      const before = beforeOf(node, workflow.defaults);
      const reads = {
        ...(field === "prompt" && before !== undefined
          ? { before: beforeFields(before) }
          : {}),
        ...itemOf(id, ITEM_FIELDS.has(field)),
      };
      return typeof value === "string"
        ? checkTemplate(id, field, value, context, reads)
        : [];
    }),
  );
  const fromCalls = Object.entries(workflow.nodes).flatMap(([id, node]) =>
    node.type === "workflow.call"
      ? Object.entries(node.inputs ?? {}).flatMap(([name, value]) =>
          checkTemplate(id, `inputs.${name}`, value, context, itemOf(id)),
        )
      : [],
  );
  const fromEnv = Object.entries(workflow.nodes).flatMap(([id, node]) =>
    programsOf(node).flatMap(({ at, program }) =>
      Object.entries(program.env ?? {}).flatMap(([name, value]) =>
        checkTemplate(id, [...at, "env", name], value, context, {
          env: true,
          // Only the node's own `env:`, not that of its `before:` or `verify:`.
          ...itemOf(id, at.length === 0),
        }),
      ),
    ),
  );
  const fromMcp = Object.entries(workflow.nodes).flatMap(([id, node]) =>
    node.type === "mcp.call"
      ? stringsIn(node.arguments ?? {}, ["arguments"]).flatMap(({ at, text }) =>
          checkTemplate(id, at, text, context, itemOf(id)),
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
  // A lock is taken before its node runs, so its name reads only the inputs
  // (ADR-085). `nodes` and `run` are reported here; `item`, `index` and `env`
  // by `checkTemplate`, and an unknown root as `template.scope`.
  const fromLocks = Object.entries(workflow.nodes).flatMap(([id, node]) => {
    const parsed = "lock" in node ? parseTemplate(node.lock ?? "") : undefined;
    return parsed?.ok === true
      ? parsed.parts.flatMap(part =>
          typeof part === "string"
            ? []
            : collectPaths(part.expr)
                .filter(([root]) => root === "nodes" || root === "run")
                .map(segments =>
                  error(
                    "lock.scope",
                    `\`${describePath(segments)}\`: a lock's name reads only \`inputs\`, since it is taken before the node runs`,
                    ["nodes", id, "lock"],
                  ),
                ),
        )
      : [];
  });
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
                : isItemRoot(segments[0])
                  ? checkItemRead(segments, undefined, path)
                  : checkAbsolute(segments, context, path),
            ),
      );
    },
  );
  const fromDefaults = checkDefaultsBefore(workflow, context);
  return [
    ...fromDefaults,
    ...fromTemplates,
    ...fromCalls,
    ...fromEnv,
    ...fromSteps,
    ...fromMcp,
    ...fromLocks,
    ...checkToolEnv(workflow),
    ...fromOutputs,
    ...checkConditionRefs(workflow, edges, rules, context),
  ];
};
