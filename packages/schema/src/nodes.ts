/**
 * @file The node types of the workflow format (Claude, tool, control and gate
 *   nodes) as Zod schemas.
 */

import { z } from "zod";

export const NodeIdSchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9_-]*$/u,
    "node ids are lowercase: letters, digits, '-' and '_'",
  );
export type NodeId = z.infer<typeof NodeIdSchema>;

export const DriverSchema = z.enum(["sdk", "cli"]);
export type Driver = z.infer<typeof DriverSchema>;

/** `opus`, `sonnet`, `haiku`, or a full model id such as `claude-opus-5-5`. */
export const ModelSchema = z.string().min(1);

/**
 * - `worktree`: own git worktree and branch, based on the owner's branch.
 * - `shared`: works in the owner's checkout (or the project root).
 * - `readonly`: shared checkout; write tools are denied.
 */
export const IsolationSchema = z.enum(["worktree", "shared", "readonly"]);
export type Isolation = z.infer<typeof IsolationSchema>;

export const BudgetSchema = z.number().positive();

/**
 * Ork's built-in practices (ADR-021), on unless turned off. A node without a
 * setting takes its nearest owner's, then the workflow's `defaults`.
 */
export const PracticesSchema = z.strictObject({
  caveman: z
    .boolean()
    .optional()
    .describe("Terse voice in chat, reports and messages. Default: on."),
  ponytail: z
    .union([z.boolean(), z.enum(["lite", "full", "ultra"])])
    .optional()
    .describe("Smallest complete change. true is full. Default: full."),
});
export type Practices = z.infer<typeof PracticesSchema>;
export const TurnsSchema = z.number().int().positive();

const base = {
  parent: NodeIdSchema.optional().describe(
    "Owner of this node in the ownership tree.",
  ),
  label: z.string().optional(),
  description: z.string().optional(),
};

const ToolRulesSchema = z.strictObject({
  allow: z.array(z.string()).optional(),
  deny: z.array(z.string()).optional(),
});

const claudeFields = {
  ...base,
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
  model: ModelSchema.optional(),
  driver: DriverSchema.optional(),
  skills: z
    .array(z.string())
    .optional()
    .describe("Node-layer skills (highest precedence)."),
  context: z.array(z.string()).optional().describe("Node-layer context files."),
  isolation: IsolationSchema.optional(),
  budgetUsd: BudgetSchema.optional(),
  maxTurns: TurnsSchema.optional(),
  practices: PracticesSchema.optional(),
  tools: ToolRulesSchema.optional(),
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

export const ClaudeLeaderNodeSchema = z.strictObject({
  type: z.literal("claude.leader"),
  ...claudeFields,
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

const toolFields = {
  ...base,
  command: z
    .string()
    .describe("Arguments for the CLI (no shell). Supports templates."),
  allow: z
    .array(z.string())
    .optional()
    .describe("Allowed subcommand prefixes, e.g. ['pr view', 'pr merge']."),
  cwd: z.string().optional(),
};

export const GhToolNodeSchema = z.strictObject({
  type: z.literal("tool.gh"),
  ...toolFields,
});

export const AwsToolNodeSchema = z.strictObject({
  type: z.literal("tool.aws"),
  ...toolFields,
  profile: z.string().optional(),
  region: z.string().optional(),
});

export const ShellToolNodeSchema = z.strictObject({
  type: z.literal("tool.shell"),
  ...toolFields,
  command: z
    .string()
    .describe("Program and arguments (no shell). Supports templates."),
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
  question: z.string(),
  options: z.array(DecisionOptionSchema).min(2),
  recommended: z.string().optional(),
  timeout: z
    .string()
    .regex(/^\d+[smh]$/u, "use e.g. 30s, 15m, 2h")
    .optional(),
  default: z
    .string()
    .optional()
    .describe("Option chosen when the timeout expires."),
});

export const NodeSchema = z.discriminatedUnion("type", [
  ClaudeLeaderNodeSchema,
  ClaudeWorkerNodeSchema,
  ClaudeSubagentNodeSchema,
  GhToolNodeSchema,
  AwsToolNodeSchema,
  ShellToolNodeSchema,
  SplitNodeSchema,
  JoinNodeSchema,
  RouterNodeSchema,
  HumanGateNodeSchema,
]);
export type Node = z.infer<typeof NodeSchema>;
export type NodeType = Node["type"];
export type ClaudeNode = Extract<Node, { type: `claude.${string}` }>;

export const CLAUDE_NODE_TYPES: readonly NodeType[] = [
  "claude.leader",
  "claude.worker",
  "claude.subagent",
];

export const isClaudeNode = (node: Node): node is ClaudeNode =>
  CLAUDE_NODE_TYPES.includes(node.type);
