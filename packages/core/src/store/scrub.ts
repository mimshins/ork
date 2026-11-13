/**
 * @file Masking the values of the user's secret variables in text Ork stores:
 *   what a tool node's program prints, and a run's own messages. A plain
 *   search, so a value of any size or shape takes time in step with the text:
 *   it looks in the text as it is, and with JSON's escapes decoded once and
 *   twice, so that it does not matter which characters an encoder chose to
 *   escape. It masks the value, and the pieces programs print on their own:
 *   each line, and each value of a JSON document. Other encodings, such as
 *   base64, are out of its reach (L81).
 */

import { type Environ, readEnv } from "../project/environ.ts";

/** Shorter values than this would mask ordinary text: `1`, `true`, a word. */
const MIN_SECRET_LENGTH = 8;

/** What the text is looked at as, and where a place in it is in the original. */
type View = { text: string; toSource: (index: number) => number };

const SHORT_ESCAPES: Readonly<Record<string, string>> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};

/** The unit an escape at `at` stands for, and how long it is written. */
const escapeAt = (
  text: string,
  at: number,
): { unit: string; width: number } | null => {
  const next = text.charAt(at + 1);
  const short = SHORT_ESCAPES[next];
  if (short !== undefined) return { unit: short, width: 2 };
  if (next !== "u") return null;
  const hex = text.slice(at + 2, at + 6);
  return /^[\da-f]{4}$/iu.test(hex)
    ? { unit: String.fromCodePoint(Number(`0x${hex}`)), width: 6 }
    : null;
};

/** The last mark at or before `index`, by a binary search. */
const lastMark = (marks: readonly number[], index: number): number => {
  let low = 0;
  let high = marks.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if ((marks[middle] ?? 0) <= index) low = middle;
    else high = middle - 1;
  }
  return low;
};

/** The view with its escapes decoded; `null` when it has none. */
const decoded = (view: View): View | null => {
  const { text } = view;
  const parts: string[] = [];
  const decodedAt = [0];
  const sourceAt = [0];
  let from = 0;
  let length = 0;
  let at = text.indexOf("\\");
  while (at !== -1) {
    const escape = escapeAt(text, at);
    if (escape === null) {
      at = text.indexOf("\\", at + 1);
    } else {
      parts.push(text.slice(from, at), escape.unit);
      length += at - from;
      decodedAt.push(length);
      sourceAt.push(at);
      length += 1;
      from = at + escape.width;
      decodedAt.push(length);
      sourceAt.push(from);
      at = text.indexOf("\\", from);
    }
  }
  if (from === 0) return null;
  parts.push(text.slice(from));
  return {
    text: parts.join(""),
    toSource: index => {
      const mark = lastMark(decodedAt, index);
      return view.toSource(
        (sourceAt[mark] ?? 0) + (index - (decodedAt[mark] ?? 0)),
      );
    },
  };
};

/** The text as it is, then decoded as far as JSON inside JSON goes. */
const viewsOf = (text: string): View[] => {
  const raw: View = { text, toSource: index => index };
  const once = decoded(raw);
  const twice = once === null ? null : decoded(once);
  return [
    raw,
    ...(once === null ? [] : [once]),
    ...(twice === null ? [] : [twice]),
  ];
};

/** Where each secret is in the text, overlapping ones joined. */
const rangesOf = (
  text: string,
  secrets: readonly string[],
): [number, number][] => {
  const found: [number, number][] = [];
  for (const view of viewsOf(text)) {
    for (const secret of secrets) {
      let at = view.text.indexOf(secret);
      while (at !== -1) {
        found.push([view.toSource(at), view.toSource(at + secret.length)]);
        at = view.text.indexOf(secret, at + secret.length);
      }
    }
  }
  const joined: [number, number][] = [];
  for (const [start, end] of found.toSorted((a, b) => a[0] - b[0])) {
    const last = joined.at(-1);
    if (last !== undefined && start < last[1]) last[1] = Math.max(last[1], end);
    else joined.push([start, end]);
  }
  return joined;
};

/** The strings and numbers inside a parsed JSON document. */
const leavesOf = (value: unknown): string[] => {
  if (typeof value === "string") return [value];
  if (typeof value === "number") return [String(value)];
  if (typeof value === "object" && value !== null) {
    return Object.values(value).flatMap(item => leavesOf(item));
  }
  return [];
};

/** A value's leaves, when it is a JSON object or array. */
const jsonLeavesOf = (value: string): string[] => {
  if (!/^\s*[[{]/u.test(value)) return [];
  try {
    return leavesOf(JSON.parse(value));
  } catch {
    return [];
  }
};

/** A value, and the pieces of it a program may well print on their own. */
const formsOf = (value: string): string[] => [
  value,
  value.trim(),
  ...value.split(/\r?\n|\r/u).map(line => line.trim()),
  ...jsonLeavesOf(value),
];

/** Replaces the values, in any form JSON writes them, with `[masked]`. */
export const scrubberOf = (values: readonly string[]) => {
  const secrets = [...new Set(values.flatMap(value => formsOf(value)))].filter(
    secret => secret.trim().length >= MIN_SECRET_LENGTH,
  );
  return (text: string): string => {
    if (secrets.length === 0) return text;
    const parts: string[] = [];
    let from = 0;
    for (const [start, end] of rangesOf(text, secrets)) {
      parts.push(text.slice(from, start), "[masked]");
      from = end;
    }
    parts.push(text.slice(from));
    return parts.join("");
  };
};

/** The values of the variables named that are set. */
export const envValuesOf = (
  names: readonly string[],
  environ: Environ,
): string[] =>
  names.flatMap(name => {
    const value = readEnv(environ, name);
    return value === undefined ? [] : [value];
  });

/** What a run masks in a message of its own: the named variables' values. */
export const runScrubber = (names: readonly string[], environ: Environ) =>
  scrubberOf(envValuesOf(names, environ));
