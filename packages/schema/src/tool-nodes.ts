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

import {
  nodeBaseFields,
  notifyFields,
  TimeoutSchema,
  toolProgramFields,
} from "./settings.ts";

const toolFields = {
  ...nodeBaseFields,
  command: z
    .string()
    .describe("Arguments for the CLI (no shell). Supports templates."),
  allow: z
    .array(z.string())
    .optional()
    .describe("Allowed subcommand prefixes, e.g. ['pr view', 'pr merge']."),
  cwd: z.string().optional(),
  timeout: TimeoutSchema.optional().describe(
    "How long the command may run, e.g. 5m; then it is killed and the node fails.",
  ),
  ...toolProgramFields,
  ...notifyFields,
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
  const command =
    integration.program === null
      ? {
          command: z
            .string()
            .describe("Program and arguments (no shell). Supports templates."),
        }
      : {};
  const schema: z.ZodObject = toolBase(
    `${TOOL_PREFIX}${integration.id}`,
  ).extend({ ...command, ...integration.options });
  // Sound: the extension only adds the integration's fields to the shared
  // shape, so every value it accepts has the shared shape's type.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see above
  return schema as ToolNodeSchema;
};

/** A node schema per registered integration (ADR-022), in registry order. */
export const TOOL_NODE_SCHEMAS: readonly ToolNodeSchema[] = INTEGRATIONS.map(
  i => toolNodeSchema(i),
);
