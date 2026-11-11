/**
 * @file A redrawn region of the terminal: a prompt draws its lines, and draws
 *   them again, moving the cursor up over its own lines and clearing down,
 *   never the screen. When it is done it leaves one line (or none). The cursor
 *   is hidden while a region is open unless a prompt places it, and is always
 *   restored by {@link Region.finish}. While a region is open, a line another
 *   part of the program prints (a run's transcript, from parallel nodes) goes
 *   through {@link printAbove}, which erases the region, prints the line and
 *   draws the region again, so the rows the region counts stay true.
 */

import { rowsOf } from "./layout.ts";
import type { Term, TermStream } from "./mode.ts";

const UP = (n: number): string => (n > 0 ? `\u001B[${String(n)}A` : "");
const CLEAR_DOWN = "\r\u001B[J";
const HIDE = "\u001B[?25l";
const SHOW = "\u001B[?25h";

export type Region = {
  /**
   * Replaces what the region shows with `lines`. With `column` (0-based, in the
   * last line) the cursor is shown there; without, it is hidden.
   */
  draw: (lines: readonly string[], column?: number) => void;
  /** Draws the last lines again, for a resize. */
  redraw: () => void;
  /**
   * Prints `text` and its line break above the region, which stays at the
   * bottom.
   */
  above: (text: string) => void;
  /** Erases the region, writes `line` (when given) and shows the cursor. */
  finish: (line?: string) => void;
};

/** The regions drawn now, the newest last. */
const open = new Set<Region>();

/**
 * Prints `text` above the open region, if one is drawn: `true`, and the caller
 * writes nothing. `false` when no region is open, and the caller writes as
 * usual.
 */
export const printAbove = (text: string): boolean => {
  const region = [...open].at(-1);
  if (region === undefined) return false;
  region.above(text);
  return true;
};

/** A region at the cursor of `out`; `term` gives the width, read live. */
export const createRegion = (out: TermStream, term: () => Term): Region => {
  /** Rows between the cursor and the region's first row. */
  let up = 0;
  let last: { lines: readonly string[]; column: number | undefined } = {
    lines: [],
    column: undefined,
  };
  const erase = (): string => `${UP(up)}${CLEAR_DOWN}`;
  const draw = (lines: readonly string[], column?: number): void => {
    open.add(region);
    const width = term().width;
    last = { lines, column };
    const rows = lines.reduce((sum, line) => sum + rowsOf(line, width), 0);
    const placed =
      column === undefined
        ? HIDE
        : `${SHOW}\r${column > 0 ? `\u001B[${String(column)}C` : ""}`;
    out.write(`${erase()}${lines.join("\n")}${placed}`);
    up = Math.max(0, rows - 1);
  };
  const region: Region = {
    draw,
    redraw: () => {
      draw(last.lines, last.column);
    },
    above: text => {
      out.write(`${erase()}${text}\n`);
      up = 0;
      draw(last.lines, last.column);
    },
    finish: line => {
      out.write(`${erase()}${line === undefined ? "" : `${line}\n`}${SHOW}`);
      up = 0;
      last = { lines: [], column: undefined };
      open.delete(region);
    },
  };
  return region;
};
