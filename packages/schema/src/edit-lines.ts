/**
 * @file Keeping the lines an edit didn't touch (RFC-008). The YAML library
 *   rewrites what it prints: wrapped text is joined, numbers are reformatted, a
 *   comment moves to its own line. So the file is printed twice, before and
 *   after the edits, and only what differs between those two replaces anything
 *   in the original: a three-way merge. If the result means something other
 *   than the edit, the library's output stands.
 */

import { parseDocument } from "yaml";

import { sameValue } from "./edit-order.ts";

/** How a file is laid out, so what's printed for an edit fits around it. */
export const styleOf = (
  text: string,
): { lineWidth: 0; indent: number; indentSeq: boolean } => {
  const indented = /^( +)[^\s#-]/mu.exec(text)?.[1]?.length ?? 2;
  return {
    lineWidth: 0,
    indent: Math.min(Math.max(indented, 1), 8),
    // A list written at its key's own column: `edges:` then `- a -> b`.
    indentSeq: !/^( *)[^\s#:-][^:\n]*:[ \t]*(?:#[^\n]*)?\r?\n\1- /mu.test(text),
  };
};

/** A line with the spacing the library may change taken out. */
const looseLine = (line: string): string =>
  line
    .replaceAll(/([[{])\s+/gu, "$1")
    .replaceAll(/\s+([\]}])/gu, "$1")
    .replaceAll(/\s*,\s*/gu, ",")
    .replaceAll(/\s+/gu, " ")
    .trim();

/** Too many lines left to compare after the ends match: not worth the time. */
const MOST_CELLS = 4_000_000;

/** Which lines of `a` are the same lines of `b`: index in `a` to index in `b`. */
const matchLines = (
  a: readonly string[],
  b: readonly string[],
): Map<number, number> | undefined => {
  const matched = new Map<number, number>();
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    matched.set(start, start);
    start += 1;
  }
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
    matched.set(endA, endB);
  }
  const rows = endA - start;
  const columns = endB - start;
  if (rows * columns > MOST_CELLS) return undefined;
  const longest = Array.from(
    { length: rows + 1 },
    () => new Uint32Array(columns + 1),
  );
  const cell = (row: number, column: number): number =>
    longest[row]?.[column] ?? 0;
  for (let row = rows - 1; row >= 0; row -= 1) {
    const own = longest[row];
    if (own === undefined) continue;
    for (let column = columns - 1; column >= 0; column -= 1) {
      own[column] =
        a[start + row] === b[start + column]
          ? cell(row + 1, column + 1) + 1
          : Math.max(cell(row + 1, column), cell(row, column + 1));
    }
  }
  let row = 0;
  let column = 0;
  while (row < rows && column < columns) {
    if (a[start + row] === b[start + column]) {
      matched.set(start + row, start + column);
      row += 1;
      column += 1;
    } else if (cell(row + 1, column) >= cell(row, column + 1)) {
      row += 1;
    } else {
      column += 1;
    }
  }
  return matched;
};

const sameLines = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((line, index) => line === b[index]);

/** The three-way merge, as lines. */
const merged = (
  original: readonly string[],
  before: readonly string[],
  after: readonly string[],
): string[] | undefined => {
  const toAfter = matchLines(before, after);
  const toOriginal = matchLines(
    before.map(line => looseLine(line)),
    original.map(line => looseLine(line)),
  );
  if (toAfter === undefined || toOriginal === undefined) return undefined;
  const out: string[] = [];
  let fromBefore = 0;
  let fromAfter = 0;
  let fromOriginal = 0;
  const upTo = (atBefore: number, atAfter: number, atOriginal: number) => {
    const untouched = sameLines(
      before.slice(fromBefore, atBefore),
      after.slice(fromAfter, atAfter),
    );
    out.push(
      ...(untouched
        ? original.slice(fromOriginal, atOriginal)
        : after.slice(fromAfter, atAfter)),
    );
  };
  for (let line = 0; line < before.length; line += 1) {
    const atAfter = toAfter.get(line);
    const atOriginal = toOriginal.get(line);
    if (atAfter !== undefined && atOriginal !== undefined) {
      upTo(line, atAfter, atOriginal);
      out.push(original[atOriginal] ?? "");
      fromBefore = line + 1;
      fromAfter = atAfter + 1;
      fromOriginal = atOriginal + 1;
    }
  }
  upTo(before.length, after.length, original.length);
  return out;
};

/**
 * What to write: `after`, with every stretch that `before` and `after` agree on
 * written as it is in `original`.
 */
export const keepingUntouchedLines = (
  original: string,
  before: string,
  after: string,
): string => {
  const ending = original.includes("\r\n") ? "\r\n" : "\n";
  const lines = merged(
    original.split(/\r?\n/u),
    before.split("\n"),
    after.split("\n"),
  );
  if (lines === undefined) return after;
  const text = lines.join(ending);
  const parsed = parseDocument(text, { prettyErrors: false });
  return parsed.errors.length === 0 &&
    sameValue(parsed.toJS(), parseDocument(after).toJS())
    ? text
    : after;
};
