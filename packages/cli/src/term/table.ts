/**
 * @file Aligned columns for the listing commands: each column as wide as its
 *   widest cell, a two-space gap, the last column left unpadded. Rich, a cell
 *   may be a chip and a table wider than the screen cuts its flexible columns
 *   with `…`; plain, nothing is cut or styled, as the listings always printed.
 */

import { style } from "../output.ts";
import { chip } from "./chips.ts";
import { cut, widthOf } from "./layout.ts";
import type { Term } from "./mode.ts";
import type { Role } from "./theme.ts";

/** A cell: its plain text, how to style it, and optionally a rich chip. */
export type Cell = {
  text: string;
  /** Styles the padded text (rich or plain: `style` is itself plain-safe). */
  look?: (padded: string) => string;
  /** Rich only: shown as a chip with this word instead of `text`. */
  chip?: { label: string; role: Role };
};

/** A dimmed header cell. */
export const header = (text: string): Cell => ({
  text,
  look: s => style("dim", s),
});

/** A column: right-aligned for numbers, flexible when it may be cut. */
export type Column = { align?: "right"; flex?: boolean };

const GAP = "  ";
/** A flexible column is never cut under this many columns. */
const MIN_FLEX = 8;

/** The text a cell shows, and its columns. */
const shown = (term: Term, cell: Cell): string =>
  term.rich && cell.chip !== undefined ? cell.chip.label : cell.text;

const widthOfCell = (term: Term, cell: Cell): number =>
  widthOf(shown(term, cell)) + (term.rich && cell.chip !== undefined ? 2 : 0);

/** The lines of a table, one per row (a header is a row the caller passes). */
export const table = (
  term: Term,
  columns: readonly Column[],
  rows: readonly (readonly Cell[])[],
  indent = "",
): string[] => {
  const widths = columns.map((_, c) =>
    Math.max(0, ...rows.map(row => widthOfCell(term, row[c] ?? { text: "" }))),
  );
  if (term.rich) {
    const gaps = GAP.length * (columns.length - 1);
    let over =
      indent.length + widths.reduce((a, b) => a + b, 0) + gaps - term.width;
    columns.forEach((column, c) => {
      const width = widths[c] ?? 0;
      if (over <= 0 || column.flex !== true || width <= MIN_FLEX) return;
      const next = Math.max(MIN_FLEX, width - over);
      over -= width - next;
      widths[c] = next;
    });
  }
  const last = columns.length - 1;
  return rows.map(
    row =>
      indent +
      columns
        .map((column, c) => {
          const cell = row[c] ?? { text: "" };
          const width = widths[c] ?? 0;
          const look = cell.look ?? ((s: string) => s);
          if (term.rich && cell.chip !== undefined) {
            const used = widthOfCell(term, cell);
            const pad = " ".repeat(Math.max(0, width - used));
            return column.align === "right"
              ? pad + chip(term, cell.chip.label, cell.chip.role)
              : chip(term, cell.chip.label, cell.chip.role) +
                  (c === last ? "" : pad);
          }
          const text = cut(shown(term, cell), width);
          const pad = " ".repeat(Math.max(0, width - widthOf(text)));
          if (column.align === "right") return look(pad + text);
          return c === last ? look(text) : look(text + pad);
        })
        .join(GAP),
  );
};
