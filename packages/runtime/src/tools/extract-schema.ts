/**
 * @file The arguments of the `extract` tool (RFC-023, RFC-025): each step's
 *   schema, a program (a producer, then only cuts), and the `steps` and
 *   `programs` fields. A refusal says what to send instead: a misplaced step
 *   names itself and its position, a stray field lists the step's own fields,
 *   and `null` or a JSON string for `steps` or `programs` is taken as some
 *   clients send it, while the advertised JSON Schema stays an array.
 */

import { z } from "zod";

import type { CutStep, ProducerStep } from "./extract-steps.ts";

export const MAX_STEPS = 6;
export const MAX_PROGRAMS = 8;

const lines = z.number().int().positive();
export const count = z.number().int().nonnegative();

/** A step's schema: an unknown field is answered with the step's own fields. */
const stepSchema = <S extends z.ZodRawShape>(name: string, shape: S) =>
  z.strictObject(shape, {
    error: issue =>
      issue.code === "unrecognized_keys"
        ? `${name} takes: ${Object.keys(shape).join(", ")}`
        : undefined,
  });

const ReadStepSchema = stepSchema("read", {
  step: z.literal("read"),
  path: z.string().min(1).describe("Relative to your folder."),
  from: lines.optional().describe("First line, 1-based. Default: 1."),
  to: lines.optional().describe("Last line, inclusive. Default: the end."),
});

const SearchStepSchema = stepSchema("search", {
  step: z.literal("search"),
  pattern: z
    .string()
    .min(1, "empty: give a pattern, or read the file to keep every line")
    .describe("POSIX extended regular expression (git grep -E)."),
  path: z.string().min(1).optional().describe("A file or folder. Default: ."),
  ignoreCase: z.boolean().optional(),
  maxMatches: lines.max(200).optional().describe("Default: 50."),
});

const FilesStepSchema = stepSchema("files", {
  step: z.literal("files"),
  path: z.string().min(1).optional().describe("A folder. Default: ."),
  glob: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Matched against the whole path from your folder: **/*.ts, src/**/test/*.ts.",
    ),
  max: lines.max(1000).optional().describe("Default: 200."),
});

const GitStepSchema = stepSchema("git", {
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

const HeadStepSchema = stepSchema("head", {
  step: z.literal("head"),
  lines,
});

const TailStepSchema = stepSchema("tail", {
  step: z.literal("tail"),
  lines,
});

const MatchStepSchema = stepSchema("match", {
  step: z.literal("match"),
  text: z
    .string()
    .min(1, "empty: drop the match step to keep every line")
    .describe("A literal substring, or with regex: true a POSIX ERE."),
  regex: z.boolean().optional(),
  ignoreCase: z.boolean().optional(),
  context: count.optional().describe("Lines around each match. Default: 0."),
});

const CountStepSchema = stepSchema("count", { step: z.literal("count") });

const StepSchema = z.discriminatedUnion("step", [
  ReadStepSchema,
  FilesStepSchema,
  CountStepSchema,
  SearchStepSchema,
  GitStepSchema,
  HeadStepSchema,
  TailStepSchema,
  MatchStepSchema,
]);

export type Step = z.infer<typeof StepSchema>;

const PRODUCERS = new Set(["read", "files", "search", "git"]);

export const isProducer = (step: Step): step is ProducerStep =>
  PRODUCERS.has(step.step);
export const isCut = (step: Step): step is CutStep => !PRODUCERS.has(step.step);

/** Why `step` can't be at `index` of a program; `undefined` when it can. */
export const misplaced = (step: Step, index: number): string | undefined => {
  if ((index === 0) === isProducer(step)) return undefined;
  const at = `step ${String(index + 1)} is \`${step.step}\``;
  return index === 0
    ? `${at}, a cut: a program starts with read, files, search or git, and cuts (head, tail, match, count) follow that producer in the same program, as [{"step":"read",…},{"step":\`${step.step}\`,…}]; each item of programs is a separate program`
    : `${at}, a producer: only step 1 of a program is read, files, search or git, the rest are cuts (head, tail, match, count); for several producers give programs, separate programs as [[{"step":"read",…}],[{"step":"search",…}]]`;
};

/** First a producer, then only cuts; `notArray` says what was wrong instead. */
const stepsSchema = (notArray: (input: unknown) => string) =>
  z
    .array(StepSchema, {
      error: issue =>
        issue.code === "invalid_type" ? notArray(issue.input) : undefined,
    })
    .min(1)
    .max(MAX_STEPS)
    .superRefine((steps, issues) => {
      steps.forEach((step, index) => {
        const why = misplaced(step, index);
        if (why !== undefined) {
          issues.addIssue({
            code: "custom",
            path: [index, "step"],
            message: why,
          });
        }
      });
    });

const notString = (what: string) => (input: unknown) =>
  `${what}${typeof input === "string" ? ", not a string" : ""}`;

/**
 * `null` as absent, and a JSON string as what it holds: clients send both for
 * an array. `z.preprocess` leaves the advertised schema the array's.
 */
const lenient = (value: unknown): unknown => {
  if (value === null) return undefined;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
};

export const StepsField = z
  .preprocess(
    lenient,
    stepsSchema(notString("steps must be an array of steps")).optional(),
  )
  .describe("One program.");

export const ProgramsField = z
  .preprocess(
    lenient,
    z
      .array(
        stepsSchema(
          () =>
            "each program is an array of steps; wrap a single step as [[{...}]]",
        ),
        {
          error: issue =>
            issue.code === "invalid_type"
              ? notString("programs must be an array of programs")(issue.input)
              : undefined,
        },
      )
      .min(1)
      .max(MAX_PROGRAMS)
      .optional(),
  )
  .describe("Several programs, each result under its own header.");
