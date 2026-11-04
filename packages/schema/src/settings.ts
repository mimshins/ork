/**
 * @file The settings the workflow format shares between nodes, agents, defaults
 *   and project rules: ids and names, the Claude driver and model, effort,
 *   isolation, budgets and turns, the built-in practices, and tool rules.
 */

import { DRIVER_IDS } from "@krapht/ork-integrations";
import { z } from "zod";

const VariableNameSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/u);

/** What a tool node's program sees, and how it returns structured output. */
export const toolProgramFields = {
  env: z
    .record(VariableNameSchema, z.string())
    .optional()
    .describe(
      "Environment variables for the program. Values are templates, and may read the user's own variables as {{env.NAME}}.",
    ),
  plainEnv: z
    .array(VariableNameSchema)
    .optional()
    .describe(
      "Variables read as {{env.NAME}} that are not secret, such as a region: their values are not masked in what programs print.",
    ),
  output: z
    .strictObject({
      format: z
        .literal("json")
        .describe(
          "The program's result is JSON, read as output.json: the file at $ORK_OUTPUT if it wrote one, otherwise its stdout.",
        ),
    })
    .optional()
    .describe("Structured output from the program."),
};

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

/** A length of time: `30s`, `15m`, `2h`. */
export const DurationSchema = z
  .string()
  .regex(/^\d+[smh]$/u, "use e.g. 30s, 15m, 2h");

/** How long a node or a run may work; time waiting on the user does not count. */
export const TimeoutSchema = DurationSchema.refine(
  duration => !/^0+[smh]$/u.test(duration),
  "a timeout must be longer than zero",
);

const UNITS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000 };

/** `30s`, `15m`, `2h` in milliseconds; `undefined` without a timeout. */
export const timeoutMs = (timeout: string | undefined): number | undefined => {
  const match = /^(\d+)([smh])$/u.exec(timeout ?? "");
  if (match === null) return undefined;
  const [, amount = "0", unit = "s"] = match;
  return Number(amount) * (UNITS[unit] ?? 1000);
};

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
