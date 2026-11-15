/**
 * @file Fitting a prompt into a terminal shorter than it: a region taller than
 *   the screen can't be redrawn, as the cursor stops at the screen's top, so
 *   each redraw would print a new copy below the old one. A prompt keeps to
 *   {@link roomOf} rows: lines cut with a line saying how many more there are,
 *   and a list shown as the window around its cursor.
 */

import type { Term } from "./mode.ts";

/**
 * The rows a prompt may draw: one fewer than the screen has, so drawing its
 * last line never scrolls its first out of reach. At least 4, for a terminal
 * too small to fit anything.
 */
export const roomOf = (t: Term): number => Math.max(4, t.rows - 1);

/**
 * `lines` in at most `room` rows (one row each): the first ones, and a last
 * line from `more` saying how many are cut.
 */
export const cutTo = (
  lines: readonly string[],
  room: number,
  more: (count: number) => string,
): string[] => {
  if (lines.length <= room) return [...lines];
  if (room <= 0) return [];
  return [...lines.slice(0, room - 1), more(lines.length - room + 1)];
};

/**
 * The blocks around block `at` that fit `room` rows, as lines, with a line from
 * `more` above and below for the blocks left out on each side. Grows one block
 * down, then one up, while they fit.
 */
export const windowed = (
  blocks: readonly (readonly string[])[],
  at: number,
  room: number,
  more: (count: number, side: "above" | "below") => string,
): string[] => {
  const size = (lo: number, hi: number): number =>
    blocks.slice(lo, hi + 1).reduce((sum, block) => sum + block.length, 0) +
    (lo > 0 ? 1 : 0) +
    (hi < blocks.length - 1 ? 1 : 0);
  let lo = at;
  let hi = at;
  let grew = true;
  while (grew) {
    grew = false;
    if (hi + 1 < blocks.length && size(lo, hi + 1) <= room) {
      hi += 1;
      grew = true;
    }
    if (lo > 0 && size(lo - 1, hi) <= room) {
      lo -= 1;
      grew = true;
    }
  }
  return [
    ...(lo > 0 ? [more(lo, "above")] : []),
    ...blocks.slice(lo, hi + 1).flat(),
    ...(hi < blocks.length - 1 ? [more(blocks.length - 1 - hi, "below")] : []),
  ];
};

/** What a select draws, before it is fitted. */
export type SelectParts = {
  /** The card above the options. */
  head: readonly string[];
  /** Each option's lines; `compact`, only the chosen one's description. */
  blocks: (compact: boolean) => string[][];
  /** The chosen option. */
  cursor: number;
  /** The details shown (wrapped, not styled), or none. */
  details: readonly string[];
  /** Whether `d` shows details, so a cut card can say `(d)`. */
  hasDetails: boolean;
  /** Rows below the options and details: a note, the key line, the editor. */
  tail: number;
  muted: (text: string) => string;
};

/**
 * A select's card, options and details in the rows `t` has: when they don't
 * fit, only the chosen option keeps its description, the options show as a
 * window around it, the details are cut, and the card is cut last (its blank
 * gap first, so the question shows).
 */
export const fitSelect = (
  t: Term,
  p: SelectParts,
): { head: string[]; body: string[]; detail: string[] } => {
  const room = roomOf(t);
  let blocks = p.blocks(false);
  const full = p.head.length + blocks.flat().length + p.details.length + p.tail;
  if (full > room) blocks = p.blocks(true);
  const bodyRoom = room - p.tail - Math.min(p.head.length, 2);
  const body =
    blocks.flat().length <= bodyRoom
      ? blocks.flat()
      : windowed(blocks, p.cursor, bodyRoom, (count, side) =>
          p.muted(`   ${side === "above" ? "↑" : "↓"} ${String(count)} more`),
        );
  const left = room - p.tail - body.length;
  const detail = cutTo(
    p.details,
    Math.max(Math.min(p.details.length, 3), left - Math.min(p.head.length, 2)),
    count => `… ${String(count)} more lines`,
  ).map(line => p.muted(`   ${line}`));
  const headRoom = left - detail.length;
  const firstText = Math.max(
    0,
    p.head.findIndex(line => line.trim() !== ""),
  );
  const head = cutTo(
    p.head.length <= headRoom ? p.head : p.head.slice(firstText),
    headRoom,
    count =>
      p.muted(`   … ${String(count)} more lines${p.hasDetails ? " (d)" : ""}`),
  );
  return { head, body, detail };
};
