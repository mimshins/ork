/**
 * @file `feedback`: a session's way to report what got in its way, kept on the
 *   user's machine (specs/feedback.md). Every session inside a run gets it; Ork
 *   caps reports per session and drops a run's duplicates.
 */

import {
  FEEDBACK_KINDS,
  FEEDBACK_SEVERITIES,
  FEEDBACK_TARGETS,
  type FeedbackDraft,
} from "@krapht/ork-core";
import { z } from "zod";

import { defineTool, text } from "./tool.ts";

export const feedbackTool = defineTool({
  name: "feedback",
  description:
    "Report something that materially got in the way of your task: a tool that failed or misled you, context or instructions that were missing or wrong, a skill that did not fit, or a flaw in the workflow. One line plus a short body; at most a few per session. Do not report routine work or your own mistakes.",
  shape: {
    kind: z.enum(FEEDBACK_KINDS),
    target: z
      .enum(FEEDBACK_TARGETS)
      .optional()
      .describe(
        "What it is about: ork (the harness and its tools), workflow (this workflow's briefs, models, budgets, loops), or project (AGENTS.md, CLAUDE.md, skills, docs). Default: from the kind.",
      ),
    severity: z.enum(FEEDBACK_SEVERITIES).optional(),
    title: z.string().min(1).describe("One line."),
    body: z
      .string()
      .optional()
      .describe("A few sentences: what happened and what would have helped."),
    evidence: z
      .array(z.string())
      .optional()
      .describe("File paths, tool names; never pasted file contents."),
  },
  available: ({ ports }) => ports.feedback !== undefined,
  run: ({ ports }, args) => {
    const draft: FeedbackDraft = {
      kind: args.kind,
      title: args.title,
    };
    if (args.target !== undefined) draft.target = args.target;
    if (args.severity !== undefined) draft.severity = args.severity;
    if (args.body !== undefined) draft.body = args.body;
    if (args.evidence !== undefined) draft.evidence = args.evidence;
    const sent = ports.feedback?.report(draft);
    if (sent === undefined) return Promise.resolve(text("No feedback here."));
    return Promise.resolve(
      text(
        sent.ok
          ? "Recorded. Thank you; carry on with your task."
          : `Not recorded: ${sent.error}.`,
      ),
    );
  },
});
