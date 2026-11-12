/**
 * @file `follow_up`: a session's way to leave work the change leaves for later
 *   (a change for a later run, a note for another project, a message a person
 *   must send, a task or a check for the maintainer). Ork keeps it where the
 *   project's `followUps` rule says, merges duplicates, caps it per session,
 *   and never sends or runs anything on its own.
 */

import {
  FOLLOW_UP_KINDS,
  type FollowUpDue,
  type FollowUpFor,
  type NewFollowUp,
} from "@krapht/ork-core";
import { z } from "zod";

import { defineTool, text } from "./tool.ts";

const isFor = (value: string): value is FollowUpFor =>
  /^(?:agent|me|project:\S.*|person:\S.*)$/u.test(value);

const isDue = (value: string): value is FollowUpDue =>
  /^(?:now|after-merge|after-deploy|\d{4}-\d{2}-\d{2})$/u.test(value);

export const followUpTool = defineTool({
  name: "follow_up",
  description:
    "Leave work this change leaves for later and that is not yours to do now: a change for a later run (for: agent), something for another registered project (for: project:<name>), a message a person must get (for: person:<name>, kind: message, with a draft), or a task or check for the maintainer (for: me, with steps). Ork keeps it, merges duplicates, and sends or runs nothing itself. Not for problems with Ork or the workflow (use feedback), nor for what you can finish now.",
  shape: {
    title: z.string().min(1).max(200).describe("One line."),
    body: z.string().max(4000).optional().describe("What and why, briefly."),
    for: z
      .string()
      .refine(isFor, "agent, me, project:<name> or person:<name>")
      .describe("Who acts: agent, me, project:<name> or person:<name>."),
    kind: z.enum(FOLLOW_UP_KINDS),
    due: z
      .string()
      .refine(isDue, "now, after-merge, after-deploy or YYYY-MM-DD")
      .describe("now, after-merge, after-deploy, or a YYYY-MM-DD date."),
    where: z
      .array(z.string())
      .max(20)
      .optional()
      .describe("Files it is about, relative to the project root."),
    ref: z
      .string()
      .min(1)
      .optional()
      .describe(
        "The pull request or branch an after-merge follow-up waits on, when you know it.",
      ),
    draft: z
      .strictObject({
        to: z.string().min(1),
        channel: z
          .string()
          .optional()
          .describe(
            "github (to: an issue or PR URL), email, slack… A hint for the maintainer.",
          ),
        text: z.string().min(1).max(4000),
      })
      .optional()
      .describe("For a message: what the maintainer will send."),
    steps: z
      .array(
        z.strictObject({
          text: z.string().trim().min(1),
          command: z
            .string()
            .optional()
            .describe("Shown to the maintainer to copy; Ork never runs it."),
        }),
      )
      .max(20)
      .optional()
      .describe("For a task or check: what to do, in order."),
  },
  available: ({ ports }) => ports.followUps !== undefined,
  run: async ({ ports }, args) => {
    const port = ports.followUps;
    if (port === undefined) return text("No follow-ups here.");
    // The refinements above checked these; TypeScript doesn't carry them.
    if (!isFor(args.for) || !isDue(args.due)) return text("Not kept.");
    const input: NewFollowUp = {
      title: args.title,
      for: args.for,
      kind: args.kind,
      due: args.due,
      ...(args.body === undefined ? {} : { body: args.body }),
      ...(args.where === undefined ? {} : { where: args.where }),
      ...(args.ref === undefined ? {} : { ref: args.ref }),
      ...(args.draft === undefined
        ? {}
        : {
            draft: {
              to: args.draft.to,
              text: args.draft.text,
              ...(args.draft.channel === undefined
                ? {}
                : { channel: args.draft.channel }),
            },
          }),
      ...(args.steps === undefined
        ? {}
        : {
            steps: args.steps.map(step => ({
              text: step.text,
              ...(step.command === undefined ? {} : { command: step.command }),
            })),
          }),
    };
    const result = await port.add(input);
    if (!result.ok) {
      return { ...text(`Not kept: ${result.error}.`), isError: true };
    }
    const { followUp, merged, note } = result.added;
    return text(
      [
        merged
          ? `Merged into follow-up ${followUp.id}, which was already kept.`
          : `Kept as follow-up ${followUp.id}.`,
        ...(note === undefined ? [] : [note]),
        ...(result.relayed === undefined
          ? []
          : [
              `Also sent to ${result.relayed.run}/${result.relayed.node}, a live run of that project.`,
            ]),
        "Carry on with your task.",
      ].join(" "),
    );
  },
});
