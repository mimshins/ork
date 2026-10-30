/**
 * @file The shape of an Ork MCP tool: defined once, bound to one session (its
 *   node, driver and ports), and served by either driver's MCP server.
 */

import type { SessionPorts } from "@krapht/ork-core";
import type { Driver } from "@krapht/ork-schema";
import { z } from "zod";

export const ORK_SERVER = "ork";

/** The name Claude Code gives an Ork tool: `mcp__ork__<name>`. */
export const toolId = (name: string): string => `mcp__${ORK_SERVER}__${name}`;

export type ToolText = { content: { type: "text"; text: string }[] };

export const text = (value: string): ToolText => ({
  content: [{ type: "text", text: value }],
});

/** What a tool is bound to: the session that calls it. */
export type ToolContext = {
  nodeId: string;
  driver: Driver;
  ports: SessionPorts;
};

/** A tool ready for one session's MCP server. */
export type BoundTool = {
  name: string;
  description: string;
  shape: z.ZodRawShape;
  schema: z.ZodType;
  /** Allowed without a permission prompt. */
  preapproved: boolean;
  call: (args: unknown) => Promise<ToolText>;
};

/** An Ork tool: `bind` gives `null` when the session does not get it. */
export type OrkTool = {
  name: string;
  bind: (context: ToolContext) => BoundTool | null;
};

export const defineTool = <S extends z.ZodRawShape>(definition: {
  name: string;
  description: string;
  shape: S;
  /** Default: preapproved. */
  preapproved?: boolean;
  /** Default: every session. */
  available?: (context: ToolContext) => boolean;
  run: (
    context: ToolContext,
    args: z.infer<z.ZodObject<S>>,
  ) => Promise<ToolText>;
}): OrkTool => {
  const schema = z.object(definition.shape);
  return {
    name: definition.name,
    bind: context =>
      (definition.available?.(context) ?? true)
        ? {
            name: definition.name,
            description: definition.description,
            shape: definition.shape,
            schema,
            preapproved: definition.preapproved ?? true,
            call: args => definition.run(context, schema.parse(args)),
          }
        : null,
  };
};
