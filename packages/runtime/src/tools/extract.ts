/**
 * @file `extract` (RFC-023, ADR-098): reads part of a file, searches, or shows
 *   a diff in the session's folder, and returns only the extract, so a whole
 *   file or a long diff never enters the conversation. A call is 1 to 6 steps:
 *   a producer (`read`, `search`, `git`), then cuts (`head`, `tail`, `match`)
 *   that take the text before them (`extract-steps.ts`). The result is capped;
 *   `from` pages through it by rerunning the steps (nothing is stored). Every
 *   result ends with a footer counting what the producer read and what came
 *   back, which the benchmark reads from the transcript.
 */

import { z } from "zod";

import { type CutStep, type ProducerStep, runSteps } from "./extract-steps.ts";
import { defineTool, text, type ToolText } from "./tool.ts";

/** The characters one call returns. */
export const EXTRACT_CAP = 16_000;
export const MAX_STEPS = 6;

const lines = z.number().int().positive();
const count = z.number().int().nonnegative();

const ReadStepSchema = z.strictObject({
  step: z.literal("read"),
  path: z.string().min(1).describe("Relative to your folder."),
  from: lines.optional().describe("First line, 1-based. Default: 1."),
  to: lines.optional().describe("Last line, inclusive. Default: the end."),
});

const SearchStepSchema = z.strictObject({
  step: z.literal("search"),
  pattern: z
    .string()
    .min(1)
    .describe("POSIX extended regular expression (git grep -E)."),
  path: z.string().min(1).optional().describe("A file or folder. Default: ."),
  ignoreCase: z.boolean().optional(),
  maxMatches: lines.max(200).optional().describe("Default: 50."),
});

const GitStepSchema = z.strictObject({
  step: z.literal("git"),
  op: z.enum(["diff", "show", "log"]),
  ref: z.string().min(1).optional().describe("show and log. Default: HEAD."),
  base: z
    .string()
    .min(1)
    .optional()
    .describe("diff: compare against this revision or range."),
  staged: z.boolean().optional().describe("diff: the staged changes."),
  path: z.string().min(1).optional(),
  n: lines.max(50).optional().describe("log: commits. Default: 20."),
});

const HeadStepSchema = z.strictObject({
  step: z.literal("head"),
  lines,
});

const TailStepSchema = z.strictObject({
  step: z.literal("tail"),
  lines,
});

const MatchStepSchema = z.strictObject({
  step: z.literal("match"),
  text: z.string().min(1).describe("A literal substring."),
  ignoreCase: z.boolean().optional(),
  context: count.optional().describe("Lines around each match. Default: 0."),
});

const StepSchema = z.discriminatedUnion("step", [
  ReadStepSchema,
  SearchStepSchema,
  GitStepSchema,
  HeadStepSchema,
  TailStepSchema,
  MatchStepSchema,
]);

type Step = z.infer<typeof StepSchema>;

const PRODUCERS = new Set(["read", "search", "git"]);

const isProducer = (step: Step): step is ProducerStep =>
  PRODUCERS.has(step.step);
const isCut = (step: Step): step is CutStep => !PRODUCERS.has(step.step);

/** First a producer, then only cuts. */
const StepsSchema = z
  .array(StepSchema)
  .min(1)
  .max(MAX_STEPS)
  .superRefine((steps, issues) => {
    steps.forEach((step, index) => {
      if ((index === 0) === isProducer(step)) return;
      issues.addIssue({
        code: "custom",
        path: [index, "step"],
        message:
          index === 0
            ? "the first step must be read, search or git"
            : "only the first step can be read, search or git; the rest are head, tail or match",
      });
    });
  });

const footer = (read: number, returned: number): string =>
  `[extract: read ${String(read)} characters, returned ${String(returned)}]`;

/** The page of `whole` from `from`, where it was cut, and the footer. */
const paged = (whole: string, from: number, read: number): string => {
  const start = Math.min(from, whole.length);
  const end = Math.min(start + EXTRACT_CAP, whole.length);
  const page = whole.slice(start, end);
  const where = `characters ${String(start)}–${String(end)} of ${String(whole.length)}`;
  const notes = [
    ...(end < whole.length
      ? [
          `[cut at ${where}: add a head, tail or match step, or call extract again with from: ${String(end)}]`,
        ]
      : start > 0
        ? [`[${where}: the end]`]
        : []),
    footer(read, page.length),
  ];
  return [...(page === "" ? [] : [page]), ...notes].join("\n");
};

export const extractTool = defineTool({
  name: "extract",
  description: `Use instead of Read, cat, sed, grep or rg to read part of a file, search, or see a git diff in your folder: only what you keep enters the conversation and is reread on every later turn. Steps run in order: first one producer (read: numbered lines from–to; search: git grep -E; git: diff, show or log), then up to ${String(MAX_STEPS - 1)} cuts of its output (head, tail: lines; match: lines with a literal substring). Cut to what you need: a match or a line range, not a whole file. Returns up to ${EXTRACT_CAP.toLocaleString("en-US")} characters from \`from\`.`,
  shape: {
    steps: StepsSchema,
    from: count
      .optional()
      .describe("The character of the result to start at. Default: 0."),
  },
  available: ({ cwd }) => cwd !== undefined,
  // Deferred, sessions read with their built-in tools instead (0 calls in 7
  // of 8 sessions measured on 2026-11-17).
  alwaysLoad: true,
  run: async ({ cwd = "", denyRead }, { steps, from }): Promise<ToolText> => {
    const [first, ...cuts] = steps;
    if (
      first === undefined ||
      !isProducer(first) ||
      !cuts.every(step => isCut(step))
    ) {
      return {
        ...text("the first step must be read, search or git"),
        isError: true,
      };
    }
    const result = await runSteps(
      { cwd, ...(denyRead === undefined ? {} : { denyRead }) },
      [first, ...cuts],
    );
    return result.ok
      ? text(paged(result.text, from ?? 0, result.read))
      : { ...text(result.error), isError: true };
  },
});
