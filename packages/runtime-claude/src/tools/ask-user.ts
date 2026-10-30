/**
 * @file `ask_user`: a session asks the human to decide something only they can
 *   decide, through the run's `HumanChannel`.
 */

import type { DecisionChoice, HumanChannel } from "@krapht/ork-core";
import { z } from "zod";

import { defineTool, text } from "./tool.ts";

export const askUserTool = defineTool({
  name: "ask_user",
  description:
    "Ask the user to decide something only they can decide. Give two to four options and the one you recommend. The run waits for the answer.",
  shape: {
    question: z.string().describe("One clear question."),
    options: z
      .array(
        z.object({
          id: z.string().describe("A short id, e.g. 'keep-api'."),
          label: z.string().optional(),
          description: z
            .string()
            .optional()
            .describe("What choosing it means."),
        }),
      )
      .min(2)
      .max(4),
    recommended: z.string().optional().describe("The id you recommend."),
    context: z
      .string()
      .optional()
      .describe("What the user needs to know to decide, in a few sentences."),
  },
  run: async ({ nodeId, ports }, args) => {
    const question: Parameters<HumanChannel["ask"]>[0] = {
      nodeId,
      question: args.question,
      options: args.options.map(o => {
        const choice: DecisionChoice = { id: o.id };
        if (o.label !== undefined) choice.label = o.label;
        if (o.description !== undefined) choice.description = o.description;
        return choice;
      }),
    };
    if (args.recommended !== undefined) question.recommended = args.recommended;
    if (args.context !== undefined) question.context = args.context;
    const answer = await ports.human.ask(question);
    return text(`The user chose: ${answer}`);
  },
});
