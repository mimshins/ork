/**
 * @file Layout for plain text: its width, wrapped to a width, cut to one line
 *   with `…`, and hung under a lead. `wrap`, `cut` and `hang` take text before
 *   it is styled (they would cut inside an escape code), so style each piece
 *   after laying it out; `widthOf` and `rowsOf` ignore escape codes. Width
 *   counts one column per code point: wide characters (CJK, emoji) may overrun
 *   a line (specs/gaps.md).
 */

import { stripVTControlCharacters } from "node:util";

/** The columns of `text`, escape codes not counted. */
export const widthOf = (text: string): number =>
  Array.from(stripVTControlCharacters(text)).length;

/** `text` of one line within `width`, with `…` where it was cut. */
export const cut = (text: string, width: number): string => {
  const chars = Array.from(text);
  return chars.length <= width
    ? text
    : `${chars.slice(0, Math.max(0, width - 1)).join("")}…`;
};

/** A word that is over `width` is split into pieces of `width`. */
const pieces = (word: string, width: number): string[] => {
  const chars = Array.from(word);
  const out: string[] = [];
  for (let i = 0; i < chars.length; i += width) {
    out.push(chars.slice(i, i + width).join(""));
  }
  return out;
};

/**
 * `text` wrapped to lines of at most `width` columns, at spaces; each line
 * break in `text` stays, and a blank line stays blank. A word longer than the
 * width is split.
 */
export const wrap = (text: string, width: number): string[] =>
  text.split("\n").flatMap(paragraph => {
    const words = paragraph.split(/ +/u).filter(word => word !== "");
    const lines: string[] = [];
    let line = "";
    for (const word of words.flatMap(w => pieces(w, width))) {
      if (line === "") line = word;
      else if (widthOf(line) + 1 + widthOf(word) <= width) line += ` ${word}`;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
    return lines;
  });

/**
 * `text` wrapped under `lead`: the first line starts with `lead`, the others
 * with spaces as wide as `lead` (a hanging indent), all within `width`.
 */
export const hang = (lead: string, text: string, width: number): string[] => {
  const indent = " ".repeat(widthOf(lead));
  return wrap(text, Math.max(1, width - indent.length)).map((line, index) =>
    (index === 0 ? lead : indent).concat(line),
  );
};

/** How many terminal rows `line` takes at `width` (at least one). */
export const rowsOf = (line: string, width: number): number =>
  Math.max(1, Math.ceil(widthOf(line) / width));
