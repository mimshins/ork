/**
 * @file `ork __onboard canon <file>…`: rewrites each workflow file through
 *   `serializeWorkflow`, so what the writer drafted is in canonical form. The
 *   only way the CLI reaches the serializer (G18). A file that does not parse
 *   is left as it was; a link is refused (specs/cli/onboard-verbs.md#canon).
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { plainPathInside, writePlainFile } from "@krapht/ork-core";
import { parseWorkflow, serializeWorkflow } from "@krapht/ork-schema";

export type CanonResult =
  | { file: string; status: "canonical" | "rewrote" }
  | { file: string; status: "failed"; reason: string };

/**
 * Rewrites one file under `base` through the serializer when its text differs.
 * `base` is where a link is refused from: a file with a link on its way (or
 * outside `base`) is never read or written.
 */
export const canonFile = (base: string, file: string): CanonResult => {
  const absolute = path.resolve(base, file);
  if (!plainPathInside(base, absolute)) {
    return {
      file,
      status: "failed",
      reason: "is a link, or behind one, or is outside the folder",
    };
  }
  let text: string;
  try {
    text = readFileSync(absolute, "utf8");
  } catch {
    return { file, status: "failed", reason: "cannot read file" };
  }
  const parsed = parseWorkflow(text);
  if (!parsed.ok) {
    const first = parsed.diagnostics[0];
    return {
      file,
      status: "failed",
      reason: first === undefined ? "invalid" : first.message,
    };
  }
  const canonical = serializeWorkflow(parsed.workflow);
  if (canonical === text) return { file, status: "canonical" };
  const written = writePlainFile(base, absolute, canonical, file);
  return written.ok
    ? { file, status: "rewrote" }
    : { file, status: "failed", reason: written.error };
};

/** Every file in turn: the others are still done when one fails. */
export const canonFiles = (
  base: string,
  files: readonly string[],
): CanonResult[] => files.map(file => canonFile(base, file));
