/**
 * @file What a Claude node is asked: its brief, rendered against the run's
 *   inputs and outputs, the model and effort it runs on (a fanned node's from
 *   its item), and its `agent.subagent` children as Claude Code subagents of
 *   its session (the SDK's `agents`, the CLI's `--agents`). A subagent's role
 *   (its agent's instructions), `instructions` and `prompt` are its system
 *   prompt, and its `description` says when the session hands it work with the
 *   Agent tool; it runs inside that session, with no process, worktree or edges
 *   of its own.
 */

import {
  type ClaudeNode,
  type Defaults,
  type Effort,
  isClaudeNode,
  type Workflow,
} from "@krapht/ork-schema";

import { renderTemplate, parseTemplate } from "../expr/evaluate.ts";
import { itemEffort, itemSetting, nodeReadOf } from "../graph/item-settings.ts";
import type { SubagentSpec } from "../runtime/types.ts";
import { modelDriver } from "./driver.ts";
import { runScope } from "./scope.ts";
import type { NodeItem, NodeOutput } from "./types.ts";

/** The tool a session hands a subagent work with. */
export const AGENT_TOOL = "Agent";

type Values = Record<string, string | number | boolean>;

export type RenderedBrief =
  | { ok: true; text: string; warnings: string[] }
  | { ok: false; error: string };

/**
 * A brief rendered against the run. Without `outputs` (a node run on its own)
 * `{{nodes.*}}` renders empty, with a warning.
 */
export const renderBrief = (
  text: string | undefined,
  inputs: Values,
  outputs?: Record<string, NodeOutput>,
  before?: NodeOutput,
  item?: NodeItem,
): RenderedBrief => {
  const template = parseTemplate(text ?? "");
  if (!template.ok) return { ok: false, error: template.message };
  const warnings = template.parts.flatMap(part => {
    if (typeof part === "string" || part.expr.kind !== "path") return [];
    const [root] = part.expr.segments;
    return root === "nodes" && outputs === undefined
      ? [
          `the brief reads ${part.expr.segments.join(".")}, which is empty when the node runs alone`,
        ]
      : [];
  });
  const scope = {
    ...runScope(inputs, outputs ?? {}, undefined, item),
    before,
  };
  return {
    ok: true,
    text: renderTemplate(template.parts, scope).trim(),
    warnings,
  };
};

/**
 * What an empty render of a `model` or `effort` that reads a node's output
 * means: with outputs, that node gave nothing, which fails the session; without
 * (a node run alone), the default applies, with a warning.
 */
const emptyRead = (
  field: "model" | "effort",
  value: string | undefined,
  given: string | undefined,
  outputs: Record<string, NodeOutput> | undefined,
): { error?: string; warning?: string } => {
  const read = value === undefined ? undefined : nodeReadOf(value);
  if (read === undefined || given !== undefined) return {};
  return outputs === undefined
    ? {
        warning: `\`${field}: ${value ?? ""}\` reads node ${read}, which is empty when the node runs alone, so the default applies`,
      }
    : {
        error: `${field}: ${value ?? ""} gave nothing: node ${read} has no output or an empty one`,
      };
};

/**
 * The model and effort a session asks for: the node's own, rendered with the
 * run's inputs, the outputs before it and its item on a fanned node, else the
 * workflow's defaults. A value that is no model name or effort level fails it,
 * and so does an empty one read from a node's output.
 */
export const modelOf = (
  node: ClaudeNode,
  defaults: Defaults,
  run: {
    inputs: Values;
    outputs?: Record<string, NodeOutput> | undefined;
    item?: NodeItem;
  },
):
  | {
      ok: true;
      model: string | undefined;
      effort: Effort | undefined;
      warnings: string[];
    }
  | { ok: false; error: string } => {
  const scope = runScope(run.inputs, run.outputs ?? {}, undefined, run.item);
  const model = itemSetting("model", node.model, scope);
  if (!model.ok) return model;
  const effort = itemEffort(node.effort, scope);
  if (!effort.ok) return effort;
  const empties = [
    emptyRead("model", node.model, model.value, run.outputs),
    emptyRead("effort", node.effort, effort.value, run.outputs),
  ];
  const failed = empties.find(empty => empty.error !== undefined)?.error;
  if (failed !== undefined) return { ok: false, error: failed };
  return {
    ok: true,
    model: model.value ?? defaults.model,
    effort: effort.value ?? defaults.effort,
    warnings: empties.flatMap(empty => empty.warning ?? []),
  };
};

const rendered = (
  text: string | undefined,
  inputs: Values,
  outputs: Record<string, NodeOutput>,
): string => {
  const brief = renderBrief(text, inputs, outputs);
  return brief.ok ? brief.text : (text ?? "").trim();
};

/**
 * The subagents of `owner`'s session, by node id, or none; or why one's model
 * fails (a template that renders no model name).
 */
export const subagentsOf = (
  workflow: Workflow,
  owner: string,
  inputs: Values,
  given?: Record<string, NodeOutput>,
):
  | { ok: true; agents: Record<string, SubagentSpec> | undefined }
  | { ok: false; error: string } => {
  const outputs = given ?? {};
  const failures: string[] = [];
  const entries = Object.entries(workflow.nodes).flatMap(([id, node]) => {
    if (node.type !== "agent.subagent" || node.parent !== owner) return [];
    if (!isClaudeNode(node)) return [];
    // Its own model only: none leaves its owner's session's.
    const models = modelOf(node, {}, { inputs, outputs: given });
    if (!models.ok) {
      failures.push(`sub-agent \`${id}\`: ${models.error}`);
      return [];
    }
    const role =
      node.agent === undefined
        ? ""
        : (workflow.agents?.[node.agent]?.instructions?.trim() ?? "");
    const prompt = [
      role,
      rendered(node.instructions, inputs, outputs),
      rendered(node.prompt, inputs, outputs),
    ]
      .filter(part => part !== "")
      .join("\n\n");
    const spec: SubagentSpec = {
      description: node.description,
      prompt: prompt === "" ? node.description : prompt,
    };
    // Its driver is its owner's; `driverRefusals` refuses another prefix.
    if (models.model !== undefined) {
      spec.model = modelDriver(models.model).model;
    }
    if (node.maxTurns !== undefined) spec.maxTurns = node.maxTurns;
    if (node.tools?.only !== undefined) spec.tools = node.tools.only;
    if (node.tools?.deny !== undefined) spec.disallowedTools = node.tools.deny;
    return [[id, spec] as const];
  });
  const [failure] = failures;
  if (failure !== undefined) return { ok: false, error: failure };
  return {
    ok: true,
    agents: entries.length === 0 ? undefined : Object.fromEntries(entries),
  };
};
