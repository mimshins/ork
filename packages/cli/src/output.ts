/**
 * @file Terminal output helpers: styled text that turns plain when stdout is
 *   not a TTY or `NO_COLOR` is set, and a yes-or-no question on the terminal.
 */

import { createInterface } from "node:readline/promises";
import { styleText } from "node:util";

type Format = Parameters<typeof styleText>[0];

/** Styles text for stdout; plain when stdout is not a TTY or NO_COLOR is set. */
export const style = (format: Format, text: string): string =>
  styleText(format, text, { stream: process.stdout });

export const write = (text: string): void => {
  process.stdout.write(`${text}\n`);
};

export const writeErr = (text: string): void => {
  process.stderr.write(`${text}\n`);
};

/** Asks a yes-or-no question on the terminal; anything but yes is no. */
export const confirm = async (question: string): Promise<boolean> => {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await rl.question(question);
    return ["y", "yes"].includes(answer.trim().toLowerCase());
  } finally {
    rl.close();
  }
};
