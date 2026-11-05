/**
 * @file A step: a program a node runs around its session (RFC-006), with the
 *   same fields a tool node gives a program, so a value reaches one in one way.
 *   `before:` sets a node up, and `verify:` has to pass before a report is
 *   accepted.
 */

import { z } from "zod";

import { TimeoutSchema, toolProgramFields } from "./settings.ts";

/** What a program is: a command, or the text of a short one. */
export const runFields = {
  command: z
    .string()
    .optional()
    .describe(
      "Program and arguments (no shell), or script: instead. Supports templates.",
    ),
  script: z
    .string()
    .optional()
    .describe(
      "The text of a short program, instead of command. It takes no templates: values arrive through env:, as $NAME, so a value cannot become code.",
    ),
  interpreter: z
    .string()
    .optional()
    .describe(
      "What runs `script:`: a program and arguments. Default: `sh -eu`.",
    ),
};

export const StepSchema = z.strictObject({
  ...runFields,
  ...toolProgramFields,
  timeout: TimeoutSchema.optional().describe(
    "How long the program may run, e.g. 5m; then it is killed and the step fails.",
  ),
});
export type Step = z.infer<typeof StepSchema>;

export const VerifySchema = StepSchema.extend({
  attempts: z
    .number()
    .int()
    .min(0)
    .max(5)
    .optional()
    .describe(
      "How many times a failed check resumes the session to fix it before the node fails. Default: 1.",
    ),
}).describe(
  "A program that must pass before the node's report is accepted. It runs in the node's checkout.",
);
export type Verify = z.infer<typeof VerifySchema>;

/** The fields a leader or worker takes its steps from. */
export const stepFields = {
  before: StepSchema.optional().describe(
    "A program to run in the node's checkout before its session starts: if it fails, the node fails and no model turn is spent. Its prompt can read {{before.stdout}}, {{before.json.*}}.",
  ),
  verify: VerifySchema.optional(),
};
