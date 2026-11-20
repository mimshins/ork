/**
 * @file `extract` (RFC-023, ADR-098; RFC-025): reads part of a file, lists
 *   files, searches, or shows a diff in the session's folder, and returns only
 *   the extract, so a whole file or a long diff never enters the conversation.
 *   A program is 1 to 6 steps: a producer (`read`, `files`, `search`, `git`),
 *   then cuts (`head`, `tail`, `match`, `count`) that take the text before them
 *   (`extract-steps.ts`; the arguments' schema is `extract-schema.ts`). A call
 *   runs one program (`steps`) or up to 8 (`programs`), each result under its
 *   own header: Code Mode without code. The result is capped; `from` pages
 *   through it by rerunning the steps (nothing is stored). Every result ends
 *   with a footer counting what the producer read and what came back, which the
 *   benchmark reads from the transcript.
 */

import {
  count,
  isCut,
  isProducer,
  MAX_PROGRAMS,
  MAX_STEPS,
  misplaced,
  ProgramsField,
  type Step,
  StepsField,
} from "./extract-schema.ts";
import { type CutStep, type ProducerStep, runSteps } from "./extract-steps.ts";
import {
  BAD_ARGUMENTS,
  defineTool,
  ORK_FAILED,
  text,
  type ToolText,
} from "./tool.ts";

/** The characters one call returns. */
export const EXTRACT_CAP = 16_000;

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

type Program = [ProducerStep, ...CutStep[]];

/** The steps as a program: a producer, then only cuts. */
const programOf = (steps: readonly Step[]): Program | undefined => {
  const [first, ...rest] = steps;
  const cuts = rest.filter(step => isCut(step));
  return first !== undefined && isProducer(first) && cuts.length === rest.length
    ? [first, ...cuts]
    : undefined;
};

/** A program's header in a `programs` result: its producer in a few words. */
const label = (step: ProducerStep): string => {
  switch (step.step) {
    case "read":
      return step.from === undefined && step.to === undefined
        ? `read ${step.path}`
        : `read ${step.path}:${String(step.from ?? 1)}-${step.to === undefined ? "end" : String(step.to)}`;
    case "files":
      return `files ${step.glob ?? step.path ?? "."}`;
    case "search":
      return `search ${step.pattern}${step.path === undefined ? "" : ` in ${step.path}`}`;
    case "git":
      return `git ${step.op}${step.path === undefined ? "" : ` ${step.path}`}`;
    default:
      return step satisfies never;
  }
};

/** Ork's own failure: its decoder keeps the message after the marker. */
const failed = (message: string): ToolText => ({
  ...text(`${ORK_FAILED}\n${message}`),
  isError: true,
});

/** An error the call's arguments caused: its decoder files it as theirs. */
const refused = (message: string): ToolText => ({
  ...text(`${BAD_ARGUMENTS}\n${message}`),
  isError: true,
});

export const extractTool = defineTool({
  name: "extract",
  description: `Use instead of Read, Glob, Grep, cat, sed, grep, rg, find or git in the shell to read part of a file, list files, search, or see git output in your folder: only what you keep enters the conversation and is reread on every later turn. A program is steps run in order: first one producer (read: numbered lines from–to; files: the folder's files, filtered by a glob; search: git grep -E in one path or several separated by spaces, with a glob to filter files, context lines around hits, and regex: false for fixed text; git: diff, show or log), then up to ${String(MAX_STEPS - 1)} cuts of its output (head, tail: lines; match: lines with a literal substring, or a POSIX ERE with regex: true, and context lines around; count: how many lines). Pass one program as steps, or up to ${String(MAX_PROGRAMS)} as programs to read several files or run several searches in one call. Cut to what you need: a match or a line range, not a whole file. Returns up to ${EXTRACT_CAP.toLocaleString("en-US")} characters from \`from\`.`,
  shape: {
    steps: StepsField,
    programs: ProgramsField,
    from: count
      .optional()
      .describe("The character of the result to start at. Default: 0."),
  },
  available: ({ cwd }) => cwd !== undefined,
  // Deferred, sessions read with their built-in tools instead (0 calls in 7
  // of 8 sessions measured on 2026-11-17).
  alwaysLoad: true,
  run: async (
    { cwd = "", denyRead },
    { steps, programs, from },
  ): Promise<ToolText> => {
    if ((steps === undefined) === (programs === undefined)) {
      return refused("give either steps (one program) or programs, not both");
    }
    const asked = programs ?? [steps ?? []];
    const parsed = asked.map(program => programOf(program));
    const valid = parsed.filter(program => program !== undefined);
    if (valid.length !== parsed.length) {
      // The schema's refinement refused these already; this narrows the type.
      const why = asked
        .flatMap(program => program.map((step, at) => misplaced(step, at)))
        .find(reason => reason !== undefined);
      return refused(why ?? "a program starts with read, files, search or git");
    }
    const context = { cwd, ...(denyRead === undefined ? {} : { denyRead }) };
    const results = await Promise.all(
      valid.map(program => runSteps(context, program)),
    );
    const [only] = results;
    if (programs === undefined && only !== undefined) {
      if (only.ok) return text(paged(only.text, from ?? 0, only.read));
      return only.byArguments ? refused(only.error) : failed(only.error);
    }
    const whole = results
      .map((result, index) => {
        const head = `### ${String(index + 1)}. ${label(valid[index]?.[0] ?? { step: "files" })}`;
        const body = result.ok
          ? result.text === ""
            ? "[nothing]"
            : result.text
          : `[error: ${result.error}]`;
        return `${head}\n${body}`;
      })
      .join("\n\n");
    const read = results.reduce(
      (sum, result) => sum + (result.ok ? result.read : 0),
      0,
    );
    if (results.some(result => result.ok)) {
      return text(paged(whole, from ?? 0, read));
    }
    // Ork's failure when any program failed for a reason of its own. That
    // error leads, as the line a decoder keeps (`orkMessage`).
    const errors = results.flatMap(result => (result.ok ? [] : [result]));
    const ours = errors.find(error => !error.byArguments);
    const lead = `${(ours ?? errors[0])?.error ?? ""}\n\n${whole}`;
    return ours === undefined ? refused(lead) : failed(lead);
  },
});
