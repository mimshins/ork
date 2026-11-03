/**
 * @file A tool node's structured result (`output: { format: json }`): the file
 *   at `$ORK_OUTPUT` when the program wrote one, otherwise its whole stdout. A
 *   result that cannot be read fails the node rather than turning into an empty
 *   value, and one too large to keep in an event is never cut.
 */

import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

export type JsonResult =
  | { ok: true; json: unknown }
  | { ok: false; error: string };

/** A clean place for the program to write to, in the run's files. */
export const prepareOutputFile = (
  runDir: string,
  id: string,
  round: number,
): string => {
  mkdirSync(runDir, { recursive: true });
  const file = path.join(runDir, `${id}.${String(round)}.output.json`);
  // A run that resumes must not read what an earlier go left.
  rmSync(file, { force: true });
  return file;
};

const parsed = (
  text: string,
  source: string,
  scrub: (text: string) => string,
): JsonResult => {
  if (text.trim() === "") return { ok: false, error: `${source} is empty` };
  try {
    const json: unknown = JSON.parse(text, (_key, value: unknown) =>
      typeof value === "string" ? scrub(value) : value,
    );
    return { ok: true, json };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `${source} is not valid JSON: ${reason}` };
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
  const written = existsSync(file);
  const result = written
    ? parsed(readFileSync(file, "utf8"), "$ORK_OUTPUT", scrub)
    : parsed(stdout, "stdout", scrub);
  rmSync(file, { force: true });
  if (!result.ok) return result;
  const text = JSON.stringify(result.json) ?? "";
  return text.length <= limit
    ? result
    : {
        ok: false,
        error: `the JSON result is ${String(text.length)} characters, over the limit of ${String(limit)}; it is in ${keep(text)}`,
      };
};
