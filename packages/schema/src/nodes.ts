/**
 * @file The node types of the workflow format (Claude, tool, control and gate
 *   nodes) as Zod schemas.
 */

import { TOOL_PREFIX } from "@krapht/ork-integrations";
import { z } from "zod";

import {
  AgentNameSchema,
  BudgetSchema,
  DriverSchema,
  DurationSchema,
  EffortSchema,
  IsolationSchema,
  ModelSchema,
  NodeIdSchema,
  nodeBaseFields,
  notifyFields,
  PracticesSchema,
  TimeoutSchema,
  ToolRulesSchema,
  TurnsSchema,
} from "./settings.ts";
import { TOOL_NODE_SCHEMAS } from "./tool-nodes.ts";

const base = nodeBaseFields;

/**
 * What an agent brings to the node it fills, and what a plain Claude node sets
 * itself. A node's own value wins over its agent's.
 */
export const agentSettings = {
  model: ModelSchema.optional(),
  effort: EffortSchema.optional(),
  driver: DriverSchema.optional(),
  skills: z
    .array(z.string())
    .optional()
    .describe("Node-layer skills (highest precedence)."),
  context: z.array(z.string()).optional().describe("Node-layer context files."),
  isolation: IsolationSchema.optional(),
  budgetUsd: BudgetSchema.optional(),
  maxTurns: TurnsSchema.optional(),
  timeout: TimeoutSchema.optional().describe(
    "How long the node may work, e.g. 30m; time waiting on the user does not count.",
  ),
  practices: PracticesSchema.optional(),
  tools: ToolRulesSchema.optional(),
  session: z
    .enum(["fresh", "resume"])
    .optional()
    .describe(
      "When the node runs again (a loop, another delegation): resume its session, or start a fresh one with the new input. Default: resume for a leader, fresh for a worker.",
    ),
  output: z
    .strictObject({
      schema: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          "Extra structured fields the node must report, e.g. { verdict: [approve, escalate] }.",
        ),
    })
    .optional(),
};

/** The settings keys an agent can bring, in canonical order. */
export const AGENT_SETTING_KEYS = [
  "model",
  "effort",
  "driver",
  "skills",
  "context",
  "isolation",
  "budgetUsd",
  "maxTurns",
  "timeout",
  "practices",
  "tools",
  "session",
  "output",
] as const satisfies readonly (keyof typeof agentSettings)[];

const claudeFields = {
  ...base,
  agent: AgentNameSchema.optional().describe(
    "The agent that fills this node; its settings apply where the node sets none, and the prompt is its task.",
  ),
  prompt: z
    .string()
    .optional()
    .describe(
      "Task brief. Supports {{inputs.*}} and {{nodes.<id>.output.*}} templates.",
    ),
  instructions: z
    .string()
    .optional()
    .describe("Node-layer instructions appended to the system prompt."),
  ...agentSettings,
};

export const ClaudeLeaderNodeSchema = z.strictObject({
  type: z.literal("claude.leader"),
  ...claudeFields,
  ...notifyFields,
  maxWorkers: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("Cap on dynamically spawned workers."),
});

export const ClaudeWorkerNodeSchema = z.strictObject({
  type: z.literal("claude.worker"),
  ...claudeFields,
  ...notifyFields,
});

export const ClaudeSubagentNodeSchema = z.strictObject({
  type: z.literal("claude.subagent"),
  ...claudeFields,
  parent: NodeIdSchema.describe(
    "The Claude node whose session hosts this sub-agent.",
  ),
  description: z
    .string()
    .describe("When the parent should use this sub-agent."),
});

export const SplitNodeSchema = z.strictObject({
  type: z.literal("control.split"),
  ...base,
});

export const JoinNodeSchema = z.strictObject({
  type: z.literal("control.join"),
  ...base,
  mode: z.enum(["all", "any", "n"]).optional().describe("Default: all."),
  n: z.number().int().positive().optional(),
});

export const RouterNodeSchema = z.strictObject({
  type: z.literal("control.router"),
  ...base,
  mode: z
    .enum(["first", "all"])
    .optional()
    .describe("Follow the first matching edge (default), or every match."),
});

export const DecisionOptionSchema = z.union([
  z.string(),
  z.strictObject({
    id: z.string(),
    label: z.string().optional(),
    description: z.string().optional(),
  }),
]);
export type DecisionOption = z.infer<typeof DecisionOptionSchema>;

export const HumanGateNodeSchema = z.strictObject({
  type: z.literal("human.gate"),
  ...base,
  ...notifyFields,
  question: z.string(),
  options: z.array(DecisionOptionSchema).min(2),
  recommended: z.string().optional(),
  timeout: DurationSchema.optional(),
  default: z
    .string()
    .optional()
    .describe("Option chosen when the timeout expires."),
});

export const WorkflowCallNodeSchema = z.strictObject({
  type: z.literal("workflow.call"),
  ...base,
  ...notifyFields,
  workflow: z
    .string()
    .describe("The workflow's name, as in its project's workflows folder."),
  project: z
    .string()
    .optional()
    .describe("A registered project's id. Default: this project."),
  node: NodeIdSchema.optional().describe(
    "A leader or worker of the called workflow to talk to and wait on; the call then keeps one run as a conversation.",
  ),
  inputs: z
    .record(z.string(), z.string())
    .optional()
    .describe("The called workflow's inputs. Supports templates."),
  wait: z
    .enum(["run", "node", "none"])
    .optional()
    .describe(
      "When this node finishes: the run has ended (default without `node`), the node has reported (default with `node`), or as soon as the run has started.",
    ),
  ref: z
    .string()
    .optional()
    .describe(
      "What the called run's worktrees start from, e.g. {{nodes.build.output.branch}}.",
    ),
  timeout: TimeoutSchema.optional().describe(
    "How long the call may take, e.g. 30m; then the called run is stopped and the node fails.",
  ),
  maxMessages: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Ask the user whether to go on after this many messages."),
});

export const NodeSchema = z.discriminatedUnion("type", [
  ClaudeLeaderNodeSchema,
  ClaudeWorkerNodeSchema,
  ClaudeSubagentNodeSchema,
  ...TOOL_NODE_SCHEMAS,
  SplitNodeSchema,
  JoinNodeSchema,
  RouterNodeSchema,
  HumanGateNodeSchema,
  WorkflowCallNodeSchema,
]);
export type Node = z.infer<typeof NodeSchema>;
export type NodeType = Node["type"];
export type ClaudeNode = Extract<Node, { type: `claude.${string}` }>;
export type ToolNode = Extract<Node, { type: `tool.${string}` }>;

export const isToolNode = (node: Node): node is ToolNode =>
  node.type.startsWith(TOOL_PREFIX);

export const CLAUDE_NODE_TYPES: readonly NodeType[] = [
  "claude.leader",
  "claude.worker",
  "claude.subagent",
];

export const isClaudeNode = (node: Node): node is ClaudeNode =>
  CLAUDE_NODE_TYPES.includes(node.type);
