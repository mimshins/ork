/**
 * @file The select prompt's options: how one is named (its label, then its id
 *   dimmed in parentheses, `Allow (allow)`, or its id alone), the numbered
 *   lines of the plain prompt (`1) label (id) - description`), and which option
 *   a typed answer names.
 */

import { cut, widthOf, wrap } from "./layout.ts";
import type { Term } from "./mode.ts";
import { paint } from "./theme.ts";

export type SelectOption = {
  id: string;
  label?: string;
  description?: string;
};

/** How text is drawn: as it is, or bold and colored for the selected option. */
export type Look = (text: string) => string;

export const asIs: Look = text => text;

/**
 * An option's name in at most `width` columns: its label, then its id (what
 * `ork decide --choose` and a plain prompt take) dimmed in parentheses; the id
 * alone when it has no label.
 */
export const nameOf = (
  t: Term,
  option: SelectOption,
  width: number,
  look: Look = asIs,
): string => {
  if (width < 1) return "";
  if (option.label === undefined) return look(cut(option.id, width));
  const head = cut(option.label, width);
  const room = width - widthOf(head);
  return room <= 1
    ? look(head)
    : `${look(head)}${paint(t, "muted", cut(` (${option.id})`, room))}`;
};

/**
 * An option's name wrapped into lines of at most `width` columns, never cut:
 * its label (or its id alone) word by word in `look`, then its id dimmed in
 * parentheses and `mark` (such as ` (recommended)`) in green, each kept whole
 * where it fits. A decision's options are what a person decides on, so they are
 * shown in full.
 */
export const nameLines = (
  t: Term,
  option: SelectOption,
  width: number,
  look: Look = asIs,
  mark = "",
): string[] => {
  if (width < 1) return [];
  const words = (text: string, style: Look) =>
    text
      .split(/ +/u)
      .filter(word => word !== "")
      .flatMap(word => wrap(word, width).map(piece => ({ piece, style })));
  const muted: Look = text => paint(t, "muted", text);
  const ok: Look = text => paint(t, "ok", text);
  const tokens = [
    ...words(option.label ?? option.id, look),
    ...(option.label === undefined ? [] : words(`(${option.id})`, muted)),
    ...words(mark, ok),
  ];
  const lines: string[] = [];
  let line = "";
  let used = 0;
  for (const { piece, style } of tokens) {
    const size = widthOf(piece);
    if (used > 0 && used + 1 + size > width) {
      lines.push(line);
      line = "";
      used = 0;
    }
    line = used === 0 ? style(piece) : `${line} ${style(piece)}`;
    used += (used === 0 ? 0 : 1) + size;
  }
  if (used > 0) lines.push(line);
  return lines;
};

/** The numbered option lines of a plain prompt: ` 1) label (id) - description`. */
export const plainOptions = (
  options: readonly SelectOption[],
  recommended: string | undefined,
): string[] =>
  options.map((option, i) => {
    const description =
      option.description === undefined ? "" : ` - ${option.description}`;
    const mark = option.id === recommended ? " (recommended)" : "";
    const name =
      option.label === undefined ? option.id : `${option.label} (${option.id})`;
    return `  ${String(i + 1)}) ${name}${description}${mark}`;
  });

/** The option an answer names: its number, or its id; empty is `recommended`. */
export const pickOption = (
  answer: string,
  options: readonly SelectOption[],
  recommended: string | undefined,
): string | undefined => {
  const value = answer.trim();
  if (value === "") return recommended;
  const index = Number(value);
  if (Number.isInteger(index) && index >= 1 && index <= options.length) {
    return options[index - 1]?.id;
  }
  return options.find(o => o.id === value)?.id;
};
