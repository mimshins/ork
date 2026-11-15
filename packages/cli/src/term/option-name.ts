/**
 * @file The select prompt's options: how one is named (its label, then its id
 *   dimmed in parentheses, `Allow (allow)`, or its id alone), the numbered
 *   lines of the plain prompt (`1) label (id) - description`), and which option
 *   a typed answer names.
 */

import { cut, widthOf } from "./layout.ts";
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
