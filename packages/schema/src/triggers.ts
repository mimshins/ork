/**
 * @file `triggers.yaml` (RFC-011): what `ork watch` looks at, and which
 *   workflow each new thing it reports starts. A check is the same tool or MCP
 *   call a node would make, so every integration and `allow` rule works on it.
 */

import { z } from "zod";

import { McpCallNodeSchema } from "./mcp-node.ts";
import { everySchema, NodeIdSchema } from "./settings.ts";
import { TOOL_NODE_SCHEMAS } from "./tool-nodes.ts";

/** How often a trigger may look at most: it runs with nobody watching. */
export const TRIGGER_EVERY_FLOOR = "1m";

/** How many runs a trigger may start in a day, when it doesn't say. */
export const DEFAULT_RUNS_PER_DAY = 10;

/** How many of its runs may be going at once, when it doesn't say. */
export const DEFAULT_TRIGGER_CONCURRENCY = 1;

const CheckSchema = z.discriminatedUnion("type", [
  McpCallNodeSchema,
  ...TOOL_NODE_SCHEMAS,
]);
export type TriggerCheck = z.infer<typeof CheckSchema>;

export const TriggerSchema = z.strictObject({
  every: everySchema(TRIGGER_EVERY_FLOOR).describe(
    "How long to wait between looks, e.g. 5m. At least 1m.",
  ),
  check: CheckSchema.optional().describe(
    'What to look at; it reports { "events": [{ "key": "...", "inputs": { ... } }] }. Without one, the trigger starts a run every time.',
  ),
  run: z
    .string()
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9._-]*$/u,
      "the name of a workflow in this project, not a path or a flag",
    )
    .describe("The workflow to start, by its name in this project."),
  inputs: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      "Inputs every run gets. They win over what a check reports, and aren't marked untrusted.",
    ),
  maxRunsPerDay: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Most runs to start in a calendar day. Default: 10."),
  concurrency: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "How many of its runs may be going at once. A new key waits for the next look. Default: 1.",
    ),
});
export type Trigger = z.infer<typeof TriggerSchema>;

export const TriggersFileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  triggers: z.record(NodeIdSchema, TriggerSchema),
});
export type TriggersFile = z.infer<typeof TriggersFileSchema>;

/** What a check reports: each thing it found, and the run's inputs for it. */
export const CheckReportSchema = z.object({
  events: z.array(
    z.object({
      key: z.string().min(1),
      inputs: z
        .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
        .optional(),
    }),
  ),
});
export type CheckReport = z.infer<typeof CheckReportSchema>;
export type CheckEvent = CheckReport["events"][number];
