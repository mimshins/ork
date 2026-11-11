/**
 * @file The terminal kit's one theme: a role says what a piece of text means
 *   (accent, ok, warn, danger, muted), and the theme gives it a look that reads
 *   on dark and light terminals: the 16 ANSI colors only, and a fixed
 *   foreground on every chip background. Nothing is said by color alone: a chip
 *   carries words and a mark a symbol. In plain mode every call returns the
 *   text unstyled.
 */

import { styleText } from "node:util";

import type { Term } from "./mode.ts";

type Format = Parameters<typeof styleText>[0];

/** What a piece of text means. */
export type Role = "accent" | "ok" | "warn" | "danger" | "muted";

/** The text look of each role. */
const TEXT: Record<Role, Format> = {
  accent: "cyan",
  ok: "green",
  warn: "yellow",
  danger: "red",
  // Dim, not bright black: bright black vanishes on some dark themes.
  muted: "dim",
};

/** The chip look of each role: a background and the foreground fixed on it. */
export const CHIP: Record<Role, Format> = {
  accent: ["bgCyan", "black"],
  ok: ["bgGreen", "black"],
  warn: ["bgYellow", "black"],
  danger: ["bgRed", "whiteBright"],
  muted: ["bgWhite", "black"],
};

/** The backgrounds a node chip takes, by a hash of its id. */
export const NODE_PALETTE: readonly Format[] = [
  ["bgCyan", "black"],
  ["bgGreen", "black"],
  ["bgYellow", "black"],
  ["bgMagenta", "whiteBright"],
  ["bgBlue", "whiteBright"],
  ["bgWhite", "black"],
];

/** `text` in `format` when the terminal is rich, else as is. */
export const apply = (term: Term, format: Format, text: string): string =>
  term.rich ? styleText(format, text, { validateStream: false }) : text;

/** `text` in a role's color. */
export const paint = (term: Term, role: Role, text: string): string =>
  apply(term, TEXT[role], text);

/** `text` in bold. */
export const bold = (term: Term, text: string): string =>
  apply(term, "bold", text);
