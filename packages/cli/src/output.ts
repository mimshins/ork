/**
 * @file Terminal output helpers: styled text that turns plain when stdout is
 *   not a TTY or `NO_COLOR` is set, and a yes-or-no question on the terminal.
 */

import { createInterface } from "node:readline/promises";
import { stripVTControlCharacters, styleText } from "node:util";

type Format = Parameters<typeof styleText>[0];

/** Styles text for stdout; plain when stdout is not a TTY or NO_COLOR is set. */
export const style = (format: Format, text: string): string =>
  styleText(format, text, { stream: process.stdout });

/**
 * Text from outside, fit for a terminal: escape sequences could hide a line on
 * the very screen a person judges from, and a line break could forge one.
 */
export const plain = (text: string): string =>
  stripVTControlCharacters(text).replaceAll(/[\p{Cc}\p{Bidi_Control}]/gu, " ");

export const write = (text: string): void => {
  process.stdout.write(`${text}\n`);
};

export const writeErr = (text: string): void => {
  process.stderr.write(`${text}\n`);
};

/** What a run spent: `$0.0312`, or `$0.00` for nothing. */
export const cost = (usd: number): string =>
  usd === 0 ? "$0.00" : `$${usd.toFixed(4)}`;

/** Asks a yes-or-no question on the terminal; anything but yes is no. */
export const confirm = async (question: string): Promise<boolean> => {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  // Input ending (Ctrl-D) answers nothing, which is no.
  const { promise: ended, resolve: end } = Promise.withResolvers<string>();
  rl.once("close", () => {
    end("");
  });
  try {
    const answer = await Promise.race([rl.question(question), ended]);
    return ["y", "yes"].includes(answer.trim().toLowerCase());
  } finally {
    rl.close();
  }
};
