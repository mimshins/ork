/**
 * @file The workflow file format as a Zod model: inputs, layers, defaults,
 *   inline agents, limits, nodes, edges, message channels, and the canvas
 *   layout sidecar.
 */

import { z } from "zod";

import { AgentSchema } from "./agents.ts";
import {
  AgentNameSchema,
  BudgetSchema,
  DriverSchema,
  IsolationSchema,
  EffortSchema,
  ModelSchema,
  NodeIdSchema,
  NodeSchema,
  PracticesSchema,
  TurnsSchema,
} from "./nodes.ts";

export const SCHEMA_VERSION = 1;

const NodeListSchema = z.union([NodeIdSchema, z.array(NodeIdSchema).min(1)]);

/**
 * Either the shorthand `"a -> b"`, `"a -> b, c"`, `"a, b -> c"`, or the object
 * form. `maxRounds` is required on any edge that closes a cycle.
 */
export const EdgeInputSchema = z.union([
  z.string(),
  z.strictObject({
    from: NodeListSchema,
    to: NodeListSchema,
    when: z.string().optional(),
    maxRounds: z.number().int().positive().optional(),
  }),
]);
export type EdgeInput = z.infer<typeof EdgeInputSchema>;

export const MessageChannelSchema = z.strictObject({
  between: z.tuple([NodeIdSchema, NodeIdSchema]),
});

export const InputDefSchema = z.strictObject({
  type: z
    .enum(["string", "number", "boolean"])
    .optional()
    .describe("Default: string."),
  required: z.boolean().optional(),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  description: z.string().optional(),
});
export type InputDef = z.infer<typeof InputDefSchema>;

export const ProjectLayerSchema = z.strictObject({
  instructions: z
    .enum(["inherit", "ignore"])
    .optional()
    .describe("Default: inherit."),
  skills: z
    .union([
      z.enum(["inherit", "ignore"]),
      z.strictObject({ allow: z.array(z.string()) }),
    ])
    .optional()
    .describe("Default: inherit."),
});

export const WorkflowSchema = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  name: z
    .string()
    .regex(/^[a-z0-9][a-z0-9._-]*$/u, "workflow names are lowercase slugs"),
  description: z.string().optional(),
  inputs: z.record(z.string(), InputDefSchema).optional(),
  layers: z
    .strictObject({
      skills: z.array(z.string()).optional(),
      context: z.array(z.string()).optional(),
      project: ProjectLayerSchema.optional(),
    })
    .optional(),
  defaults: z
    .strictObject({
      driver: DriverSchema.optional(),
      model: ModelSchema.optional(),
      effort: EffortSchema.optional(),
      isolation: IsolationSchema.optional(),
      budgetUsd: BudgetSchema.optional(),
      maxTurns: TurnsSchema.optional(),
      practices: PracticesSchema.optional(),
    })
    .optional(),
  agents: z
    .record(AgentNameSchema, AgentSchema)
    .optional()
    .describe(
      "Agents defined in this workflow; they win over the project's and the user's of the same name.",
    ),
  limits: z
    .strictObject({
      budgetUsd: BudgetSchema.optional().describe(
        "Hard cap for the whole run.",
      ),
      concurrency: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Max sessions running at once."),
    })
    .optional(),
  nodes: z
    .record(NodeIdSchema, NodeSchema)
    .refine(n => Object.keys(n).length > 0, "a workflow needs nodes"),
  edges: z.array(EdgeInputSchema).optional(),
  messages: z.array(MessageChannelSchema).optional(),
});
export type Workflow = z.infer<typeof WorkflowSchema>;

/** Canvas positions live next to the workflow so logic diffs stay clean. */
export const LayoutSchema = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  nodes: z.record(
    NodeIdSchema,
    z.strictObject({ x: z.number(), y: z.number() }),
  ),
  viewport: z
    .strictObject({ x: z.number(), y: z.number(), zoom: z.number() })
    .optional(),
});
export type Layout = z.infer<typeof LayoutSchema>;
