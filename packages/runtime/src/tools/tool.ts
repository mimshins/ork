/**
 * @file The shape of an Ork MCP tool: defined once, bound to one session (its
 *   node, driver and ports), and served by either driver's MCP server.
 */

import type { NodeReport, SessionPorts } from "@krapht/ork-core";
import type { Driver } from "@krapht/ork-schema";
import { z } from "zod";

export const ORK_SERVER = "ork";

/** The name Claude Code gives an Ork tool: `mcp__ork__<name>`. */
export const toolId = (name: string): string => `mcp__${ORK_SERVER}__${name}`;

export type ToolText = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

export const text = (value: string): ToolText => ({
  content: [{ type: "text", text: value }],
});

/** What a tool is bound to: the session that calls it. */
export type ToolContext = {
  nodeId: string;
  driver: Driver;
  ports: SessionPorts;
  /**
   * The session's report schema, and where the `report` tool keeps a report
   * that fits it. Set by the session runner; tests of other tools leave it
   * out.
   */
  report?: {
    schema: Record<string, unknown>;
    submit: (report: NodeReport) => void;
  };
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

const issueAt = (issue: z.core.$ZodIssue): string => {
  const where = z.core.toDotPath(issue.path);
  return where === "" ? "" : `${where}: `;
};

/** Whether `issue` is about a field of the object `parent` is about. */
const isFieldOf = (issue: z.core.$ZodIssue, parent: z.core.$ZodIssue) =>
  issue.path.length === parent.path.length + 1 &&
  parent.path.every((key, index) => key === issue.path[index]);

const expectedField = (issue: z.core.$ZodIssue): string =>
  `; the field is \`${String(issue.path.at(-1))}\`${
    issue.code === "invalid_value" ? `, one of: ${issue.values.join(", ")}` : ""
  }`;

/**
 * A failed parse as text a model can act on. A stray key is reported with the
 * fields its object lacks, read from the schema's own issues: a wrong name is
 * otherwise only a "missing" error that hides what was sent.
 */
export const readableIssues = (issues: readonly z.core.$ZodIssue[]): string => {
  const strays = issues.filter(issue => issue.code === "unrecognized_keys");
  const lacking = issues.filter(
    issue =>
      issue.input === undefined &&
      strays.some(stray => isFieldOf(issue, stray)),
  );
  return [
    ...strays.map(
      stray =>
        `${issueAt(stray)}unknown field ${stray.keys.map(key => `\`${key}\``).join(", ")}${lacking
          .filter(issue => isFieldOf(issue, stray))
          .map(issue => expectedField(issue))
          .join("")}`,
    ),
    ...issues
      .filter(
        issue => issue.code !== "unrecognized_keys" && !lacking.includes(issue),
      )
      .map(issue => `${issueAt(issue)}${issue.message}`),
  ].join("\n");
};

export const defineTool = <S extends z.ZodRawShape>(definition: {
  name: string;
  /** A function when what it says depends on the session binding the tool. */
  description: string | ((context: ToolContext) => string);
  /** A function when the arguments depend on the session binding the tool. */
  shape: S | ((context: ToolContext) => S);
  /** Default: preapproved. */
  preapproved?: boolean;
  /** Default: every session. */
  available?: (context: ToolContext) => boolean;
  run: (
    context: ToolContext,
    args: z.infer<z.ZodObject<S>>,
  ) => Promise<ToolText>;
}): OrkTool => ({
  name: definition.name,
  bind: context => {
    if (!(definition.available?.(context) ?? true)) return null;
    const shape =
      typeof definition.shape === "function"
        ? definition.shape(context)
        : definition.shape;
    const schema = z.object(shape);
    return {
      name: definition.name,
      description:
        typeof definition.description === "function"
          ? definition.description(context)
          : definition.description,
      shape,
      schema,
      preapproved: definition.preapproved ?? true,
      call: args => {
        const parsed = schema.safeParse(args, { reportInput: true });
        return parsed.success
          ? definition.run(context, parsed.data)
          : Promise.resolve({
              ...text(readableIssues(parsed.error.issues)),
              isError: true,
            });
      },
    };
  },
});
