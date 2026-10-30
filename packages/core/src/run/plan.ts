/**
 * @file Planning one Claude node's session: the rendered brief (and the task
 *   its owner delegated), the practices and Ork's harness instructions, tool
 *   rules from its isolation, limits, and the report schema.
 */

import {
  type ClaudeNode,
  isClaudeNode,
  type Workflow,
} from "@krapht/ork-schema";

import { parseTemplate, renderTemplate } from "../expr/evaluate.ts";
import { practiceInstructions, resolvePractices } from "../practices/index.ts";
import { reportSchemaFor } from "../runtime/report.ts";
import type { Ownership, SessionSpec, ToolRules } from "../runtime/types.ts";
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
};

export type PlanResult =
  | { ok: true; spec: SessionSpec; driver: "sdk" | "cli"; warnings: string[] }
  | { ok: false; error: string };

/** Tells a session where it works, so a repo's own worktree rules don't apply. */
export const checkoutInstructions = (checkout: Checkout): string =>
  checkout.own
    ? `- You are already in your own git worktree for this task, on branch \`${checkout.branch}\`, created by Ork. Work and commit here. Do not create another worktree, switch branches, or push; Ork merges your branch when you pass.`
    : `- You work in \`${checkout.owner}\`'s git worktree, on branch \`${checkout.branch}\`, created by Ork. Do not create another worktree, switch branches, or push.`;

const name = (id: string, description?: string): string =>
  description === undefined ? `\`${id}\`` : `\`${id}\` (${description})`;

/** Tells a leader how to hand work to the nodes it owns (ADR-017, ADR-018). */
export const ownershipInstructions = (
  ownership: Ownership,
  checkout?: Checkout,
): string[] => {
  if (ownership.children.length === 0) return [];
  const lines = [
    `- You own ${ownership.children.map(c => name(c.id, c.description)).join(", ")}. Hand them work with \`delegate\`: tasks in one call run in parallel, and it returns their reports when all are done. They do not see this conversation, so give each a self-contained brief: the goal, the files that matter, and what done looks like.`,
  ];
  if (checkout?.own === true) {
    lines.push(
      "- Ork commits your work before delegating and merges each passing child's branch into yours, so their changes are in your checkout when `delegate` returns. Review the reports before you report.",
    );
  }
  const left = ownership.workersLeft();
  if (ownership.templates.length > 0 && left > 0) {
    lines.push(
      `- \`spawn_worker\` starts more instances of ${ownership.templates.map(t => `\`${t}\``).join(", ")} for work that splits into independent parts (${String(left)} left).`,
    );
  }
  return lines;
};

/** Ork's own instructions for a node, kept short: they cost tokens every turn. */
export const harnessInstructions = (
  workflow: Workflow,
  id: string,
  node: ClaudeNode,
  options: Pick<PlanOptions, "checkout" | "template" | "ownership"> = {},
): string => {
  const { checkout, template } = options;
  const extra = Object.keys(node.output?.schema ?? {});
  const owner =
    node.parent === undefined ? "" : ` Your owner is \`${node.parent}\`.`;
  const instance =
    template === undefined ? "" : `, an instance of \`${template}\``;
  const lines = [
    "# Ork",
    `You are the \`${id}\` node (${node.type}${instance}) of the Ork workflow \`${workflow.name}\`.${owner}`,
    "- Work on the brief in the first message. Your owner and the user see your final report, not this conversation.",
    `- End with the structured report: \`status\`, a short \`summary\`, and \`artifacts\` (name -> repository-relative path)${extra.length > 0 ? `, plus ${extra.map(f => `\`${f}\``).join(", ")}` : ""}.`,
    "- If you are blocked on a choice only the user can make, call the `ask_user` tool with a clear question, two to four options, and the one you recommend. Never ask about what you can decide or look up yourself.",
  ];
  if (checkout !== undefined) lines.push(checkoutInstructions(checkout));
  if (options.ownership !== undefined) {
    lines.push(...ownershipInstructions(options.ownership, checkout));
  }
  if (node.instructions !== undefined) lines.push("", node.instructions);
  return lines.join("\n");
};

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

  const spec: SessionSpec = {
    nodeId: id,
    cwd: options.cwd,
    prompt: prompt === "" ? "Do the task your role describes." : prompt,
    // Practices first: they are the same for many nodes, so the cached prefix
    // is shared; the node's own instructions come after.
    systemAppend: [
      ...practiceInstructions(resolvePractices(workflow, declared), options.cwd)
        .text,
      harnessInstructions(workflow, id, node, options),
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

  return {
    ok: true,
    spec,
    driver: node.driver ?? defaults.driver ?? "sdk",
    warnings,
  };
};
