/**
 * @file The settings the workflow format shares between nodes, agents, defaults
 *   and project rules: ids and names, the Claude driver and model, effort,
 *   isolation, budgets and turns, the built-in practices, and tool rules.
 */

import { DRIVER_IDS } from "@krapht/ork-integrations";
import { z } from "zod";

export const NodeIdSchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9_-]*$/u,
    "node ids are lowercase: letters, digits, '-' and '_'",
  );
export type NodeId = z.infer<typeof NodeIdSchema>;

/** The registered Claude drivers' ids (ADR-022). */
export const DriverSchema = z.enum(DRIVER_IDS);
export type Driver = z.infer<typeof DriverSchema>;

/** `opus`, `sonnet`, `haiku`, or a full model id such as `claude-opus-5-5`. */
export const ModelSchema = z.string().min(1);

/** How hard the model thinks; Claude Code's own default when unset. */
export const EffortSchema = z
  .enum(["low", "medium", "high", "xhigh", "max"])
  .describe("Reasoning effort. Default: Claude Code's for the model.");
export type Effort = z.infer<typeof EffortSchema>;

/**
 * - `worktree`: own git worktree and branch, based on the owner's branch.
 * - `continue`: with no owner, the worktree its input came from (ADR-037).
 * - `shared`: works in the owner's checkout (or the project root).
 * - `readonly`: shared checkout; write tools are denied.
 */
const ISOLATIONS = ["worktree", "continue", "shared", "readonly"] as const;
export const IsolationSchema = z.enum(ISOLATIONS);
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

export const ToolRulesSchema = z.strictObject({
  allow: z.array(z.string()).optional(),
  deny: z.array(z.string()).optional(),
  only: z
    .array(z.string())
    .optional()
    .describe("The only built-in tools the session has; Ork's tools stay."),
});

/** Agent names: lowercase, like node ids. */
export const AgentNameSchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9_-]*$/u,
    "agent names are lowercase: letters, digits, '-' and '_'",
  );
