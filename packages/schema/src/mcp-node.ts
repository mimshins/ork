/**
 * @file The `mcp.call` node (RFC-006): one named tool on one MCP server, with
 *   no session. Where the server is defined, and how it signs in, are not in
 *   the workflow: they are in the project's `.mcp.json`.
 */

import { z } from "zod";

import { forEachFields } from "./for-each.ts";
import {
  DeclaredOutputSchema,
  nodeBaseFields,
  notifyFields,
  TimeoutSchema,
  toolProgramFields,
  WatchSchema,
} from "./settings.ts";

export const McpCallNodeSchema = z.strictObject({
  type: z.literal("mcp.call"),
  ...nodeBaseFields,
  server: z
    .string()
    .describe("The server's name in the project's `.mcp.json`."),
  tool: z.string().describe("The tool to call on it."),
  arguments: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "The tool's arguments. Strings are templates; one that is only {{ … }} keeps its value's type.",
    ),
  output: z
    .strictObject({
      schema: DeclaredOutputSchema.optional().describe(
        "The fields of the tool's JSON result a later node relies on, e.g. { state: [open, closed] }. A value outside these fails the node.",
      ),
    })
    .optional()
    .describe("What the tool's result says."),
  env: toolProgramFields.env,
  plainEnv: toolProgramFields.plainEnv,
  timeout: TimeoutSchema.optional().describe(
    "How long the call may take, e.g. 5m; then the node fails. With watch:, how long one look may take.",
  ),
  watch: WatchSchema.optional().describe(
    "Call the tool again and again until a condition holds, with no model turn.",
  ),
  ...notifyFields,
  ...forEachFields,
});
