/**
 * @file The bar down a question card's left edge: the blank first column every
 *   card line starts with becomes a bright green `▌`, so a question stands out
 *   among a run's output. Widths don't change. A blank line (the gap above the
 *   card) stays blank, a line that doesn't start with a blank is left as it is,
 *   and plain mode draws no bar.
 */

import type { Term } from "./mode.ts";
import { apply } from "./theme.ts";

/** The bar's character. */
export const BAR = "▌";

/** Where a line's text starts, after its leading color codes (`ESC[…m`). */
const textStart = (line: string): number => {
  let at = 0;
  while (line.startsWith("\u001B[", at)) {
    const end = line.indexOf("m", at);
    if (end === -1) return at;
    at = end + 1;
  }
  return at;
};

/** `lines` with the bar in their first column, on a rich terminal. */
export const barred = (t: Term, lines: readonly string[]): string[] => {
  if (!t.rich) return [...lines];
  const bar = apply(t, "greenBright", BAR);
  return lines.map(line => {
    const at = textStart(line);
    return line[at] === " "
      ? `${bar}${line.slice(0, at)}${line.slice(at + 1)}`
      : line;
  });
};
