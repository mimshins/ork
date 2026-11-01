/**
 * @file What a Claude node is asked: its brief, rendered against the run's
 *   inputs and outputs, and its `claude.subagent` children as Claude Code
 *   subagents of its session (the SDK's `agents`, the CLI's `--agents`). A
 *   subagent's role (its agent's instructions), `instructions` and `prompt` are
 *   its system prompt, and its `description` says when the session hands it
 *   work with the Agent tool; it runs inside that session, with no process,
 *   worktree or edges of its own.
 */

import { isClaudeNode, type Workflow } from "@krapht/ork-schema";

import { renderTemplate, parseTemplate } from "../expr/evaluate.ts";
import type { SubagentSpec } from "../runtime/types.ts";
import { runScope } from "./scope.ts";
import type { NodeOutput } from "./types.ts";

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
  const scope = runScope(inputs, outputs ?? {});
  return {
    ok: true,
    text: renderTemplate(template.parts, scope).trim(),
    warnings,
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

/** The subagents of `owner`'s session, by node id, or none. */
export const subagentsOf = (
  workflow: Workflow,
  owner: string,
  inputs: Values,
  outputs: Record<string, NodeOutput> = {},
): Record<string, SubagentSpec> | undefined => {
  const entries = Object.entries(workflow.nodes).flatMap(([id, node]) => {
    if (node.type !== "claude.subagent" || node.parent !== owner) return [];
    if (!isClaudeNode(node)) return [];
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
    if (node.model !== undefined) spec.model = node.model;
    if (node.maxTurns !== undefined) spec.maxTurns = node.maxTurns;
    if (node.tools?.only !== undefined) spec.tools = node.tools.only;
    if (node.tools?.deny !== undefined) spec.disallowedTools = node.tools.deny;
    return [[id, spec] as const];
  });
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
};
