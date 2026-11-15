/**
 * @file The gutter before a called run's log lines (its call path, then `›`)
 *   and a log printer laid out in the columns the gutter leaves. Shared by `ork
 *   attach` and the commands that print several runs.
 */

import { widthOf } from "../term/layout.ts";
import { MIN_WIDTH, type Term } from "../term/mode.ts";
import { paint } from "../term/theme.ts";
import { createLogPrinter, type LogOptions } from "./logs.ts";

/** A call path for reading: `plan › build`. */
export const callPathOf = (path: readonly string[]): string => path.join(" › ");

/** The gutter before a called run's lines: its call path, then ` › `. */
export const gutterOf = (path: readonly string[]): string =>
  path.length === 0 ? "" : `${callPathOf(path)} › `;

/**
 * A run's printer, laid out in the columns its gutter leaves, so a line fits
 * the terminal with the gutter before it and a wrapped line goes on under its
 * own text, not at the terminal's first column.
 */
export const printerFor = (
  term: Term,
  path: readonly string[],
  options: Pick<LogOptions, "node" | "verbose"> = {},
): ReturnType<typeof createLogPrinter> =>
  createLogPrinter({
    ...options,
    json: false,
    view: {
      term: {
        ...term,
        width: Math.max(MIN_WIDTH, term.width - widthOf(gutterOf(path))),
      },
      roots: new Map(),
    },
  });

/** Prints `lines` through `out`, each (not blank) behind `path`'s muted gutter. */
export const printUnder = (
  out: (line: string) => void,
  term: Term,
  path: readonly string[],
  lines: readonly string[],
): void => {
  const gutter = gutterOf(path);
  const prefix = gutter === "" ? "" : paint(term, "muted", gutter);
  for (const line of lines) out(line === "" ? line : `${prefix}${line}`);
};
