/**
 * @file The tool nodes of the workflow format, one schema per registered
 *   integration (ADR-022): the shared fields, and the integration's own
 *   options.
 */

import {
  INTEGRATIONS,
  type Integration,
  TOOL_PREFIX,
} from "@krapht/ork-integrations";
import { z } from "zod";

import { forEachFields } from "./for-each.ts";
import { lockFields } from "./lock.ts";
import {
  nodeBaseFields,
  notifyFields,
  TimeoutSchema,
  toolProgramFields,
  WatchSchema,
} from "./settings.ts";
import { onceField, runFields } from "./steps.ts";

const toolFields = {
  ...nodeBaseFields,
  ...runFields,
  allow: z
    .array(z.string())
    .optional()
    .describe("Allowed subcommand prefixes, e.g. `pr view`, `pr merge`."),
  cwd: z.string().optional(),
  timeout: TimeoutSchema.optional().describe(
    "How long the command may run, e.g. 5m; then it is killed and the node fails. With watch:, how long one look may take.",
  ),
  watch: WatchSchema.optional().describe(
    "Run the command again and again until a condition holds, with no model turn.",
  ),
  once: onceField,
  ...toolProgramFields,
  ...notifyFields,
  ...lockFields,
  ...forEachFields,
};

/** What every tool node has: `tool.<id>`, its command, allow list and cwd. */
const toolBase = (type: `tool.${string}`) =>
  z.strictObject({ type: z.literal(type), ...toolFields });

type ToolNodeSchema = ReturnType<typeof toolBase>;

/**
 * One integration's node schema: the shared tool fields plus the integration's
 * own options (AWS's `profile`, `region`). The static type is the shared part;
 * the options are validated at run time and read by the integration's adapter.
 */
const toolNodeSchema = (integration: Integration): ToolNodeSchema => {
  const base = toolBase(`${TOOL_PREFIX}${integration.id}`);
  const schema: z.ZodObject =
    integration.program === null
      ? base.extend(integration.options)
      : base.omit({ script: true, interpreter: true }).extend({
          command: z
            .string()
            .describe("Arguments for the CLI (no shell). Supports templates."),
          ...integration.options,
        });
  // Sound: this only adds the integration's fields to the shared shape, and
  // narrows optional ones, so every value it accepts has the shared shape's type.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see above
  return schema as ToolNodeSchema;
};

/** A node schema per registered integration (ADR-022), in registry order. */
export const TOOL_NODE_SCHEMAS: readonly ToolNodeSchema[] = INTEGRATIONS.map(
  i => toolNodeSchema(i),
);
