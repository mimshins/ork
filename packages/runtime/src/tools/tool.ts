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

/**
 * How an Ork tool's answer to arguments its schema refused starts, so a
 * driver's decoder can tell the agent's mistake from Ork's failure
 * (`tool.result`'s `fault`).
 */
export const BAD_ARGUMENTS = "Invalid arguments, nothing ran:";

/** Whether a tool result's text is Ork's answer to bad arguments. */
export const isBadArguments = (body: string): boolean =>
  body.includes(BAD_ARGUMENTS);

/**
 * How an Ork tool's failure for a reason of its own starts, so a driver's
 * decoder can tell it from another tool's error (`tool.result`'s `message`).
 */
export const ORK_FAILED = "Ork tool failed:";

// Longer than signals.ts keeps, so masking sees a secret whole before its clip.
const MESSAGE_MAX = 1000;

// Both markers are plain text: no character in them is special in a pattern.
// Anchored at the start, so another tool's error that quotes one is not kept.
const MARKED = new RegExp(
  `^\\s*(?:${BAD_ARGUMENTS}|${ORK_FAILED})\\s*([^\\n]*)`,
  "u",
);

/**
 * The message of an Ork tool's refusal or failure (`tool.result`'s `message`):
 * the first line after its marker, clipped to 1000 characters. `undefined` for
 * text that does not start with a marker, which is not Ork's to keep.
 */
export const orkMessage = (body: string): string | undefined => {
  const line = MARKED.exec(body)?.[1]?.trim() ?? "";
  return line === "" ? undefined : line.slice(0, MESSAGE_MAX);
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
  /**
   * The session's folder, for tools that read files in it (`extract`). Unset:
   * those tools are not offered.
   */
  cwd?: string;
  /** The `Read(...)` patterns of the session's `tools.deny`. */
  denyRead?: readonly string[];
  /**
   * The session's tool rules, for the `permission` tool's verdict on a shell
   * line (RFC-028). Set by the session runner; tests of other tools leave it
   * out, and the tool then asks about every call.
   */
  rules?: {
    allow: readonly string[];
    deny: readonly string[];
    unlisted?: "refuse" | "ask";
    yolo?: boolean | undefined;
    reading?: "extract" | "extract-only" | "open" | undefined;
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
  /**
   * Shown to the model up front, not deferred behind a tool search
   * (`_meta["anthropic/alwaysLoad"]` in `tools/list`, which Claude Code reads
   * and other drivers ignore): for a tool meant to replace a built-in one.
   */
  alwaysLoad: boolean;
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

/** A schema's own message for a stray key (zod's own repeats the key). */
const ownMessage = (stray: z.core.$ZodIssue): string =>
  stray.message.startsWith("Unrecognized key") ? "" : `; ${stray.message}`;

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
          .join("")}${ownMessage(stray)}`,
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
  /** Default: deferred, as the driver chooses. */
  alwaysLoad?: boolean;
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
      alwaysLoad: definition.alwaysLoad ?? false,
      call: args => {
        const parsed = schema.safeParse(args, { reportInput: true });
        return parsed.success
          ? definition.run(context, parsed.data)
          : Promise.resolve({
              ...text(
                `${BAD_ARGUMENTS}\n${readableIssues(parsed.error.issues)}`,
              ),
              isError: true,
            });
      },
    };
  },
});
