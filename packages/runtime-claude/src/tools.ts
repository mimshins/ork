/**
 * @file Ork's tools, defined once and adapted to each driver: an in-process MCP
 *   server for the Agent SDK, a local HTTP MCP server for the CLI.
 */

import type { HumanChannel } from "@krapht/ork-core";
import { z } from "zod";

export const ORK_SERVER = "ork";

export type ToolText = { content: { type: "text"; text: string }[] };

const text = (value: string): ToolText => ({
  content: [{ type: "text", text: value }],
});

export const askUserShape = {
  question: z.string().describe("One clear question."),
  options: z
    .array(
      z.object({
        id: z.string().describe("A short id, e.g. 'keep-api'."),
        label: z.string().optional(),
        description: z.string().optional().describe("What choosing it means."),
      }),
    )
    .min(2)
    .max(4),
  recommended: z.string().optional().describe("The id you recommend."),
  context: z
    .string()
    .optional()
    .describe("What the user needs to know to decide, in a few sentences."),
};

export type AskUserArgs = z.infer<z.ZodObject<typeof askUserShape>>;

export const askUser =
  (human: HumanChannel, nodeId: string) =>
  async (args: AskUserArgs): Promise<ToolText> => {
    const question: Parameters<HumanChannel["ask"]>[0] = {
      nodeId,
      question: args.question,
      options: args.options.map(o => {
        const choice: { id: string; label?: string; description?: string } = {
          id: o.id,
        };
        if (o.label !== undefined) choice.label = o.label;
        if (o.description !== undefined) choice.description = o.description;
        return choice;
      }),
    };
    if (args.recommended !== undefined) question.recommended = args.recommended;
    if (args.context !== undefined) question.context = args.context;
    const answer = await human.ask(question);
    return text(`The user chose: ${answer}`);
  };

export const ASK_USER_DESCRIPTION =
  "Ask the user to decide something only they can decide. Give two to four options and the one you recommend. The run waits for the answer.";

/** The CLI driver's `--permission-prompt-tool` contract. */
export const permissionShape = {
  tool_name: z.string(),
  input: z.record(z.string(), z.unknown()),
  tool_use_id: z.string().optional(),
};

export type PermissionArgs = z.infer<z.ZodObject<typeof permissionShape>>;

export const permission =
  (human: HumanChannel, nodeId: string) =>
  async (args: PermissionArgs): Promise<ToolText> => {
    const decision = await human.permit({
      nodeId,
      toolName: args.tool_name,
      input: args.input,
    });
    return text(
      JSON.stringify(
        decision.allow
          ? { behavior: "allow", updatedInput: args.input }
          : { behavior: "deny", message: decision.message },
      ),
    );
  };
