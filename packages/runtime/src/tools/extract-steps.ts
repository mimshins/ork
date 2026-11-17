/**
 * @file The step engine of the `extract` tool (RFC-023, option 2a): a producer
 *   step (`read`, or the git producers `search` and `git` in `extract-git.ts`)
 *   yields text, and each cut after it (`head`, `tail`, `match`) narrows the
 *   text before it. Every path is contained and checked against the deny list
 *   (`contain.ts`). Paging, the result cap and the footer are the tool's.
 */

import { readFileSync, statSync } from "node:fs";

import { type Denied, deniedRead, readable, Refused } from "./contain.ts";
import {
  type GitStep,
  gitStep,
  linesOf,
  type SearchStep,
  searchStep,
  StepError,
} from "./extract-git.ts";

export type ReadStep = {
  step: "read";
  path: string;
  /** 1-based, inclusive. */
  from?: number;
  to?: number;
};

export type ProducerStep = ReadStep | SearchStep | GitStep;

export type MatchStep = {
  step: "match";
  /** A literal substring. */
  text: string;
  ignoreCase?: boolean;
  context?: number;
};

export type CutStep =
  | { step: "head"; lines: number }
  | { step: "tail"; lines: number }
  | MatchStep;

export type StepContext = {
  cwd: string;
  /** The `Read(...)` patterns of the session's `tools.deny`. */
  denyRead?: readonly string[];
};

/** The last step's text and the size of what the producer yielded. */
export type StepOutput =
  | { ok: true; text: string; read: number }
  | { ok: false; error: string };

/** Larger files are refused: `read` loads the whole file. */
export const READ_FILE_CAP = 8 * 1024 * 1024;

const sizeOf = (real: string, asked: string): number => {
  let stat;
  try {
    stat = statSync(real);
  } catch {
    throw new StepError(`no such file: ${asked}`);
  }
  if (!stat.isFile()) throw new StepError(`not a file: ${asked}`);
  return stat.size;
};

/** The file's lines from `from` to `to`, each as `<number>: <text>`. */
const readStep = (cwd: string, step: ReadStep, denied: Denied): string => {
  const where = readable(cwd, step.path, denied);
  if (sizeOf(where.real, step.path) > READ_FILE_CAP) {
    throw new StepError(`refused: ${step.path} is over 8 MiB; search it`);
  }
  const content = readFileSync(where.real);
  if (content.subarray(0, 8192).includes(0)) {
    throw new StepError(`refused: ${step.path} (a binary file)`);
  }
  const lines = linesOf(content.toString("utf8"));
  const from = Math.max(step.from ?? 1, 1);
  return lines
    .slice(from - 1, step.to ?? lines.length)
    .map((line, index) => `${from + index}: ${line}`)
    .join("\n");
};

const produce = (
  cwd: string,
  step: ProducerStep,
  denied: Denied,
): Promise<string> => {
  if (step.step === "read") return Promise.resolve(readStep(cwd, step, denied));
  if (step.step === "search") return searchStep(cwd, step, denied);
  return gitStep(cwd, step, denied);
};

/** Lines containing `text`, with `context` lines around; `--` between runs. */
const matchLines = (lines: readonly string[], step: MatchStep): string => {
  const fold = (value: string): string =>
    step.ignoreCase === true ? value.toLowerCase() : value;
  const needle = fold(step.text);
  const context = Math.max(step.context ?? 0, 0);
  const keep = new Set<number>();
  lines.forEach((line, index) => {
    if (!fold(line).includes(needle)) return;
    const last = Math.min(index + context, lines.length - 1);
    for (let at = Math.max(index - context, 0); at <= last; at += 1) {
      keep.add(at);
    }
  });
  const kept = [...keep].toSorted((a, b) => a - b);
  return kept
    .flatMap((at, position) => {
      const line = lines[at] ?? "";
      const gap = position > 0 && at !== (kept[position - 1] ?? 0) + 1;
      return gap ? ["--", line] : [line];
    })
    .join("\n");
};

/** One cut applied to the text before it. */
export const cut = (value: string, step: CutStep): string => {
  const lines = linesOf(value);
  if (step.step === "head") {
    return lines.slice(0, Math.max(step.lines, 0)).join("\n");
  }
  if (step.step === "tail") {
    return step.lines <= 0 ? "" : lines.slice(-step.lines).join("\n");
  }
  return matchLines(lines, step);
};

/**
 * Runs a producer and its cuts in `context.cwd`. A refusal or a failure is an
 * error result with one short line; nothing is thrown for them.
 */
export const runSteps = async (
  context: StepContext,
  steps: readonly [ProducerStep, ...CutStep[]],
): Promise<StepOutput> => {
  try {
    const denied = deniedRead(context.cwd, context.denyRead);
    const [first, ...cuts] = steps;
    const produced = await produce(context.cwd, first, denied);
    return {
      ok: true,
      read: produced.length,
      text: cuts.reduce((text, step) => cut(text, step), produced),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error:
        error instanceof StepError || error instanceof Refused
          ? message
          : `extract failed: ${message.split("\n")[0] ?? ""}`,
    };
  }
};
