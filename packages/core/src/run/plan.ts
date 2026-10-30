/**
 * @file Planning one Claude node's session: the rendered brief (and the task
 *   its owner delegated), the practices, the compiled context layers and Ork's
 *   harness instructions, its plugin and settings, tool rules from its
 *   isolation, limits, and the report schema.
 */

import {
  type ClaudeNode,
  isClaudeNode,
  type Workflow,
} from "@krapht/ork-schema";

import { type ContextStack, resolveContext } from "../context/resolve.ts";
import {
  contextSections,
  sessionSettings,
  writePlugin,
} from "../context/session.ts";
import { parseTemplate, renderTemplate } from "../expr/evaluate.ts";
import {
  practiceInstructions,
  resolvePractices,
} from "../practices/practices.ts";
import { reportSchemaFor } from "../runtime/report.ts";
import type {
  Claims,
  Mailbox,
  Ownership,
  SessionSpec,
  ToolRules,
} from "../runtime/types.ts";
import { harnessInstructions } from "./harness.ts";
import { runScope } from "./scope.ts";
import type { Brief, Checkout, NodeOutput } from "./types.ts";

/** Claude Code tools that change files or run commands. */
export const WRITE_TOOLS = ["Write", "Edit", "NotebookEdit", "Bash"] as const;

export type PlanOptions = {
  cwd: string;
  inputs: Record<string, string | number | boolean>;
  /** Run a `worktree` node in the project checkout, without a worktree. */
  inPlace?: boolean;
  /**
   * The outputs of the nodes that ran before, inside a run. Without them (a
   * node run on its own) `{{nodes.*}}` renders empty, with a warning.
   */
  outputs?: Readonly<Record<string, NodeOutput>>;
  /** What is left of the run's budget; caps the node's own `budgetUsd`. */
  budgetLeftUsd?: number;
  /** The worktree the node works in, set up by the run (ADR-020). */
  checkout?: Checkout;
  /** The task the node's owner delegated; it follows the node's own prompt. */
  brief?: Brief;
  /** For a spawned worker, the declared node it is an instance of. */
  template?: string;
  /** A leader's children, when the run lets it delegate. */
  ownership?: Ownership;
  /** The node's place on the run's message bus. */
  mailbox?: Mailbox;
  /** The node's claims on files and resources, shared by the run. */
  claims?: Claims;
  /** The workflow file's folder, which skill and context paths start from. */
  workflowDir?: string;
  /** The project's root; references may not leave it. Default: `cwd`. */
  projectRoot?: string;
  /** Where to write the node's plugin; without it, no plugin is written. */
  pluginDir?: string;
  /** The user layer's home (`~`); tests pass a folder. */
  home?: string;
};

export type PlanResult =
  | {
      ok: true;
      spec: SessionSpec;
      driver: "sdk" | "cli";
      warnings: string[];
      context: ContextStack;
    }
  | { ok: false; error: string };

const toolRules = (node: ClaudeNode, readonly: boolean): ToolRules => ({
  allow: [...(node.tools?.allow ?? [])],
  deny: [...(node.tools?.deny ?? []), ...(readonly ? WRITE_TOOLS : [])],
});

/**
 * Turns one Claude node into a session spec: renders its brief, applies the
 * workflow defaults, and maps its isolation onto tool rules.
 */
export const planNodeSession = (
  workflow: Workflow,
  id: string,
  options: PlanOptions,
): PlanResult => {
  const declared = options.template ?? id;
  const node = workflow.nodes[declared];
  if (node === undefined) {
    return { ok: false, error: `unknown node "${declared}"` };
  }
  if (!isClaudeNode(node)) {
    return { ok: false, error: `"${id}" is a ${node.type}, not a Claude node` };
  }
  if (node.type === "claude.subagent") {
    return {
      ok: false,
      error: `"${id}" is a sub-agent; it runs inside "${node.parent}"'s session`,
    };
  }

  const defaults = workflow.defaults ?? {};
  const isolation = node.isolation ?? defaults.isolation ?? "worktree";
  const ownWorktree = options.checkout?.own === true;
  if (isolation === "worktree" && !ownWorktree && options.inPlace !== true) {
    return {
      ok: false,
      error: `"${id}" uses worktree isolation, which a run on its own does not set up; run the whole workflow, or pass --in-place to run it in this checkout`,
    };
  }

  const warnings: string[] = [];
  const template = parseTemplate(node.prompt ?? "");
  if (!template.ok) return { ok: false, error: `prompt: ${template.message}` };
  for (const part of template.parts) {
    if (typeof part !== "string" && part.expr.kind === "path") {
      const [root] = part.expr.segments;
      if (root === "nodes" && options.outputs === undefined) {
        warnings.push(
          `the brief reads ${part.expr.segments.join(".")}, which is empty when the node runs alone`,
        );
      }
    }
  }
  const rendered = renderTemplate(
    template.parts,
    runScope(options.inputs, options.outputs ?? {}),
  ).trim();
  const prompt = [
    rendered,
    options.brief === undefined
      ? ""
      : `## Task from \`${options.brief.from}\`\n\n${options.brief.text}`,
  ]
    .filter(part => part !== "")
    .join("\n\n");

  const projectRoot = options.projectRoot ?? options.cwd;
  const context = resolveContext({
    workflow,
    nodeId: declared,
    workflowDir: options.workflowDir ?? projectRoot,
    projectRoot,
    checkout: options.cwd,
    ...(options.home === undefined ? {} : { home: options.home }),
  });
  const problem = context.diagnostics.find(d => d.severity === "error");
  if (problem !== undefined) return { ok: false, error: problem.message };
  warnings.push(...context.diagnostics.map(d => d.message));

  const spec: SessionSpec = {
    nodeId: id,
    cwd: options.cwd,
    prompt: prompt === "" ? "Do the task your role describes." : prompt,
    // Shared before specific, for the prompt cache: the practices and the
    // user and workflow context are the same for many nodes; Ork's harness
    // and the node's own context come after.
    systemAppend: [
      ...practiceInstructions(resolvePractices(workflow, declared), options.cwd)
        .text,
      ...contextSections(context.files, "user"),
      ...contextSections(context.files, "workflow"),
      harnessInstructions(workflow, id, node, options),
      ...contextSections(context.files, "node"),
    ].join("\n\n"),
    settingSources: ["project", "local"],
    tools: toolRules(node, isolation === "readonly"),
    permissionMode: "default",
    reportSchema: reportSchemaFor(node),
  };
  const model = node.model ?? defaults.model;
  if (model !== undefined) spec.model = model;
  const effort = node.effort ?? defaults.effort;
  if (effort !== undefined) spec.effort = effort;
  const maxTurns = node.maxTurns ?? defaults.maxTurns;
  if (maxTurns !== undefined) spec.maxTurns = maxTurns;
  const budgets = [
    node.budgetUsd ?? defaults.budgetUsd,
    options.budgetLeftUsd,
  ].filter(b => b !== undefined);
  if (budgets.length > 0) spec.budgetUsd = Math.min(...budgets);
  const plugin =
    options.pluginDir === undefined
      ? null
      : writePlugin(
          context,
          options.pluginDir,
          `Skills Ork compiled for ${id}`,
        );
  if (plugin !== null) spec.plugins = [plugin];
  const settings = sessionSettings(context, options.cwd);
  if (settings !== undefined) spec.settings = settings;

  return {
    ok: true,
    spec,
    driver: node.driver ?? defaults.driver ?? "sdk",
    warnings,
    context,
  };
};
