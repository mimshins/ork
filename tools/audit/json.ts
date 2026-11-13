/**
 * @file Small helpers the audit steps share for reading and writing the JSON a
 *   model returned or a step wrote: a model's output is untrusted, so each
 *   reader narrows instead of casting.
 */

import { writeFileSync } from "node:fs";

export type Json = Record<string, unknown>;

export const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The objects in `list`; anything else is dropped. */
export const objects = (list: readonly unknown[]): Json[] =>
  list.filter(item => isObject(item));

export const str = (value: unknown): string =>
  typeof value === "string" ? value : "";

/** Writes `data` as pretty JSON with a closing newline. */
export const writeJson = (file: string, data: unknown): void => {
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
};
