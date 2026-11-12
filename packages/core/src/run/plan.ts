/**
 * @file Planning one Claude node's session: the rendered brief (and the task
 *   its owner delegated), the practices, the compiled context layers and Ork's
 *   harness instructions, its plugin and settings, tool rules from its
 *   isolation, limits, and the report schema.
 */

import {
  type ClaudeNode,
  type Driver,
  isClaudeNode,
  type Workflow,
} from "@krapht/ork-schema";

import { type ContextStack, resolveContext } from "../context/resolve.ts";
import {
  contextSections,
  sessionSettings,
  writePlugin,
} from "../context/session.ts";
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
import { AGENT_TOOL, modelOf, renderBrief, subagentsOf } from "./brief.ts";
import { driverContradiction, modelDriver, namedDriver } from "./driver.ts";
import { harnessInstructions } from "./harness.ts";
import type { Brief, Checkout, NodeItem, NodeOutput } from "./types.ts";

/** Claude Code tools that change files or run commands. */
export const WRITE_TOOLS = ["Write", "Edit", "NotebookEdit"] as const;

/**
 * Commands a readonly node runs without asking: git that only reads. Any other
 * command asks, as for any node, so a reviewer can run the tests with leave.
 */
export const READ_ONLY_COMMANDS = ["diff", "log", "show", "status"].flatMap(
  git => [`Bash(git ${git})`, `Bash(git ${git} *)`, `Bash(git -C * ${git} *)`],
);

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
  /** What the node's `before:` step gave, for its prompt to read. */
  before?: NodeOutput;
  /** What is left of the run's budget; caps the node's own `budgetUsd`. */
  budgetLeftUsd?: number;
  /** What is left of the run's tokens; caps the node's own `budgetTokens`. */
  budgetLeftTokens?: number;
  /** The worktree the node works in, set up by the run (ADR-020). */
  checkout?: Checkout;
  /** The task the node's owner delegated; it follows the node's own prompt. */
  brief?: Brief;
  /** For a spawned worker, the declared node it is an instance of. */
  template?: string;
  /** For an item of a fanned node, what its prompt reads as `{{item}}`. */
  item?: NodeItem;
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
  /** Ork's folder for the project, which lessons are read from. */
  orkDir?: string;
  /** Where to write the node's plugin; without it, no plugin is written. */
  pluginDir?: string;
  /** The user layer's home (`~`); tests pass a folder. */
  home?: string;
};

export type PlanResult =
  | {
      ok: true;
      spec: SessionSpec;
      /** What the workflow names (`driver.ts`); else the one ready here. */
      driver: Driver | undefined;
      /**
       * The driver the model names (`claude-code.opus`), as an item rendered
       * it; it wins over `--driver`. `spec.model` is the rest.
       */
      pinned: Driver | undefined;
      /** The MCP servers the session loads beside Ork's, by name. */
      mcp: string[];
      warnings: string[];
      context: ContextStack;
    }
  | { ok: false; error: string };

/** The role of the agent that fills the node, when an agent does. */
const roleSection = (workflow: Workflow, node: ClaudeNode): string[] => {
  const role =
    node.agent === undefined
      ? undefined
      : workflow.agents?.[node.agent]?.instructions?.trim();
  return role === undefined || role === ""
    ? []
    : [`# Your role: ${node.agent}\n\n${role}`];
};

/** The node's own tool rules, the project's and workflow's, and isolation's. */
const toolRules = (
  node: ClaudeNode,
  readonly: boolean,
  rules: Workflow["rules"],
  mcp: readonly string[],
): ToolRules => ({
  allow: [
    ...new Set([
      ...(rules?.permissions?.allow ?? []),
      ...(node.tools?.allow ?? []),
      // A headless node can't answer per call; the node's author chose the server.
      // Claude Code writes other characters in a server's name as `_` in tool names.
      ...mcp.map(server => `mcp__${server.replaceAll(/[^\w-]/gu, "_")}`),
      ...(readonly ? READ_ONLY_COMMANDS : []),
    ]),
  ],
  deny: [
    ...new Set([
      ...(rules?.permissions?.deny ?? []),
      ...(node.tools?.deny ?? []),
      ...(readonly ? WRITE_TOOLS : []),
    ]),
  ],
  ...(node.tools?.only === undefined ? {} : { only: node.tools.only }),
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
    return { ok: false, error: `unknown node \`${declared}\`` };
  }
  if (!isClaudeNode(node)) {
    return {
      ok: false,
      error: `\`${id}\` is a \`${node.type}\`, not a Claude node`,
    };
  }
  if (node.type === "agent.subagent") {
    return {
      ok: false,
      error: `\`${id}\` is a sub-agent; it runs inside \`${node.parent}\`'s session`,
    };
  }

  const defaults = workflow.defaults ?? {};
  const mcp = node.mcp ?? defaults.mcp ?? [];
  const isolation = node.isolation ?? defaults.isolation ?? "worktree";
  const ownWorktree = options.checkout?.own === true;
  // A `continue` node needs a worktree too: its input's, or its own.
  const needs =
    (isolation === "worktree" && !ownWorktree) ||
    (isolation === "continue" && options.checkout === undefined);
  if (needs && options.inPlace !== true) {
    return {
      ok: false,
      error: `\`${id}\` uses worktree isolation, which a run on its own does not set up; run the whole workflow, or pass \`--in-place\` to run it in this checkout`,
    };
  }

  const models = modelOf(node, defaults, options);
  if (!models.ok) return { ok: false, error: models.error };
  const contradiction = driverContradiction(node, models.model);
  if (contradiction !== undefined) {
    return { ok: false, error: `\`${id}\`: ${contradiction}` };
  }
  const model =
    models.model === undefined ? undefined : modelDriver(models.model);

  const warnings: string[] = [];
  const brief = renderBrief(
    node.prompt,
    options.inputs,
    options.outputs,
    options.before,
    options.item,
  );
  if (!brief.ok) return { ok: false, error: `prompt: ${brief.error}` };
  warnings.push(...brief.warnings);
  const rendered = brief.text;
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
    ...(options.orkDir === undefined ? {} : { orkDir: options.orkDir }),
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
      ...roleSection(workflow, node),
      harnessInstructions(workflow, id, node, options),
      ...contextSections(context.files, "node"),
    ].join("\n\n"),
    settingSources: ["project", "local"],
    tools: toolRules(node, isolation === "readonly", workflow.rules, mcp),
    permissionMode: "default",
    reportSchema: reportSchemaFor(node),
  };
  // A leader is long-lived and waits in `delegate`: an hour's cache keeps its
  // prefix across the wait (specs/context.md, N3).
  if (node.type === "agent.leader") spec.promptCache = "1h";
  const agents = subagentsOf(
    workflow,
    declared,
    options.inputs,
    options.outputs,
  );
  if (agents !== undefined) {
    spec.agents = agents;
    // A session restricted to some tools still needs the one subagents use.
    spec.tools.only?.push(AGENT_TOOL);
  }
  if (model !== undefined) spec.model = model.model;
  if (models.effort !== undefined) spec.effort = models.effort;
  const maxTurns = node.maxTurns ?? defaults.maxTurns;
  if (maxTurns !== undefined) spec.maxTurns = maxTurns;
  const budgets = [
    node.budgetUsd ?? defaults.budgetUsd,
    options.budgetLeftUsd,
  ].filter(b => b !== undefined);
  if (budgets.length > 0) spec.budgetUsd = Math.min(...budgets);
  const own = node.budgetTokens ?? defaults.budgetTokens;
  const left = options.budgetLeftTokens ?? own;
  if (left !== undefined) spec.budgetTokens = Math.min(left, own ?? left);
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
    driver: namedDriver(node, workflow),
    pinned: model?.driver,
    mcp,
    warnings,
    context,
  };
};
