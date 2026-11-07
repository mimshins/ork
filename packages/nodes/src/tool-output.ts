/**
 * @file A tool node's structured result (`output: { format: json }`): the file
 *   at `$ORK_OUTPUT` when the program wrote one, otherwise its whole stdout. A
 *   result that cannot be read fails the node rather than turning into an empty
 *   value, and one too large to keep in an event is never cut. What a program
 *   wrote is not yet scrubbed, so these files live in a private folder that a
 *   run clears when it starts and ends. A long field is kept in the run's
 *   files, named for the node, its round, and its step and try.
 */

import {
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import type { ExecuteContext } from "@krapht/ork-core";

export type JsonResult =
  | { ok: true; json: unknown }
  | { ok: false; error: string };

/** The run's private folder for results not yet read. */
const OUTPUT_FOLDER = ".output";

/**
 * Removes a result, or whatever else the program left in its place. What cannot
 * go here is reported when the run clears its folder.
 */
export const removeOutputFile = (file: string): void => {
  try {
    rmSync(file, { force: true, recursive: true });
  } catch {
    // See above.
  }
};

/**
 * Removes what a run left before it could read its results. A folder that will
 * not go is worth a warning, not worth failing a run over.
 */
export const clearOutputFiles = (
  runDir: string,
  warn: (line: string) => void,
): void => {
  const folder = path.join(runDir, OUTPUT_FOLDER);
  try {
    rmSync(folder, { force: true, recursive: true });
  } catch {
    warn(
      `Could not remove ${folder}, which may hold a result that was not scrubbed.`,
    );
  }
};

/** A clean place for the program to write to, in the run's files. */
export const prepareOutputFile = (
  runDir: string,
  id: string,
  round: number,
): string => {
  const folder = path.join(runDir, OUTPUT_FOLDER);
  mkdirSync(runDir, { recursive: true });
  mkdirSync(folder, { mode: 0o700, recursive: true });
  const file = path.join(folder, `${id}.${String(round)}.output.json`);
  // A run that resumes must not read what an earlier go left.
  removeOutputFile(file);
  return file;
};

type KeptWhere = Pick<ExecuteContext, "runDir" | "id" | "round" | "step">;

/**
 * A node's activation, and the step and its try when it is one, as a file
 * name's start: `review.1`, `review.1.before-1`, `review.1.verify-2`. Two
 * steps, or two tries of a check, never share a file.
 */
export const keptStem = ({ id, round, step }: KeptWhere): string =>
  `${id}.${String(round)}${step === undefined ? "" : `.${step.name}-${String(step.try)}`}`;

/** Where a long field of a node's output is kept. */
export const keptFile = (context: KeptWhere, field: string): string =>
  path.join(context.runDir, `${keptStem(context)}.${field}.txt`);

/** A way to write a field of a node's output to the run's files, when it's long. */
export const keepFile =
  (context: KeptWhere, field: string, text: string) => (): string => {
    mkdirSync(context.runDir, { recursive: true });
    const file = keptFile(context, field);
    writeFileSync(file, text);
    return file;
  };

/** Writes a node's `script:` where the run can start it, for this go only. */
export const writeScriptFile = (
  runDir: string,
  id: string,
  round: number,
  text: string,
): string => {
  const folder = path.join(runDir, OUTPUT_FOLDER);
  mkdirSync(folder, { mode: 0o700, recursive: true });
  const file = path.join(folder, `${id}.${String(round)}.script`);
  writeFileSync(file, text, { mode: 0o600 });
  return file;
};

/** Two keys can mask to the same text; neither value is lost. */
const scrubbedKeys = (
  value: object,
  scrub: (text: string) => string,
): [string, unknown][] => {
  const entries = Object.entries(value).map(
    ([key, item]) => [scrub(key), item] as const,
  );
  const named = new Set(entries.map(([name]) => name));
  const used = new Set<string>();
  return entries.map(([name, item]) => {
    let unique = name;
    for (let count = 2; used.has(unique); count += 1) {
      const next = `${name} ${String(count)}`;
      if (!named.has(next)) unique = next;
    }
    used.add(unique);
    return [unique, item];
  });
};

/** A parsed value with its keys and strings scrubbed; numbers are not touched. */
export const scrubbed = (
  value: unknown,
  scrub: (text: string) => string,
): unknown => {
  if (typeof value === "string") return scrub(value);
  if (Array.isArray(value)) return value.map(item => scrubbed(item, scrub));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      scrubbedKeys(value, scrub).map(([key, item]) => [
        key,
        scrubbed(item, scrub),
      ]),
    );
  }
  return value;
};

/**
 * Parses, comparing each number by its text as written as well as its value:
 * `12345678901234567890` reads back as a different number, which would no
 * longer match the secret.
 */
const parseScrubbingNumbers = (
  text: string,
  scrub: (text: string) => string,
): unknown => {
  return JSON.parse(
    text,
    (_key: string, value: unknown, seen?: { source?: string }) => {
      const source = seen?.source;
      if (typeof value !== "number" || source === undefined) return value;
      const masked = scrub(source);
      if (masked !== source) return masked;
      // Written another way (`1.2345678e7`), it may still read as the secret.
      const read = String(value);
      const maskedRead = scrub(read);
      return maskedRead === read ? value : maskedRead;
    },
  );
};

/**
 * Reads JSON with everything in it scrubbed, numbers too. Throws as a parser
 * does.
 */
export const parseScrubbed = (
  text: string,
  scrub: (text: string) => string,
): unknown => scrubbed(parseScrubbingNumbers(text, scrub), scrub);

const parsed = (
  text: string,
  source: string,
  scrub: (text: string) => string,
): JsonResult => {
  if (text.trim() === "") return { ok: false, error: `${source} is empty` };
  try {
    return { ok: true, json: parseScrubbed(text, scrub) };
  } catch (error) {
    // The parser's own message quotes the text, which may hold a secret.
    return {
      ok: false,
      error:
        error instanceof RangeError
          ? `${source} is nested too deeply to read`
          : `${source} is not valid JSON`,
    };
  }
};

/** What the program wrote to `$ORK_OUTPUT`; a link or a folder is refused. */
const readWritten = (
  file: string,
  scrub: (text: string) => string,
): JsonResult => {
  try {
    return lstatSync(file).isFile()
      ? parsed(readFileSync(file, "utf8"), "$ORK_OUTPUT", scrub)
      : { ok: false, error: "$ORK_OUTPUT is not a file" };
  } catch {
    return { ok: false, error: "$ORK_OUTPUT could not be read" };
  }
};

/** Whether something is there; a folder the program broke counts, and fails. */
const wasWritten = (file: string): boolean => {
  try {
    return lstatSync(file, { throwIfNoEntry: false }) !== undefined;
  } catch {
    return true;
  }
};

/**
 * Reads the program's result and removes its file: what is kept is the scrubbed
 * value. `limit` is how long it may be once serialized; `keep` saves one that
 * is longer and says where.
 */
export const readJsonOutput = (input: {
  file: string;
  stdout: string;
  scrub: (text: string) => string;
  limit: number;
  keep: (text: string) => string;
}): JsonResult => {
  const { file, stdout, scrub, limit, keep } = input;
  const result = wasWritten(file)
    ? readWritten(file, scrub)
    : parsed(stdout, "stdout", scrub);
  removeOutputFile(file);
  if (!result.ok) return result;
  const text = JSON.stringify(result.json) ?? "";
  return text.length <= limit
    ? result
    : {
        ok: false,
        error: `the JSON result is ${String(text.length)} characters, over the limit of ${String(limit)}; it is in ${keep(text)}`,
      };
};
