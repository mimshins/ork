/**
 * @file Narrowing parsed JSON without type assertions, for the benchmark tools:
 *   a record, a string, a number, or nothing.
 */

export type Json = Record<string, unknown>;

export const isRecord = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** `v` as a record, or an empty one. */
export const rec = (v: unknown): Json => (isRecord(v) ? v : {});

/** `v` when it is a string. */
export const text = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;

/** `v` when it is a number, else 0. */
export const count = (v: unknown): number => (typeof v === "number" ? v : 0);

/** `v`'s records, when it is an array. */
export const records = (v: unknown): Json[] =>
  Array.isArray(v) ? v.filter(x => isRecord(x)) : [];

/** Parses one JSON text, or gives nothing when it isn't JSON. */
export const parse = (line: string): unknown => {
  try {
    const value: unknown = JSON.parse(line);
    return value;
  } catch {
    return undefined;
  }
};

/** Rounds to a tenth, a hundredth or a ten-thousandth. */
export const r1 = (x: number): number => Math.round(x * 10) / 10;
export const r2 = (x: number): number => Math.round(x * 100) / 100;
export const r4 = (x: number): number => Math.round(x * 10_000) / 10_000;

/** A path with a leading `~` made absolute. */
export const expandHome = (p: string, home: string): string =>
  p.replace(/^~(?=$|\/)/u, home);
