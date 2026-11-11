/**
 * @file Terminal output helpers: styled text that turns plain when stdout is
 *   not a TTY or `NO_COLOR` is set, and a yes-or-no question on the terminal
 *   (through the terminal kit).
 */

import { stripVTControlCharacters, styleText } from "node:util";

import { confirm as askConfirm } from "./term/confirm.ts";
import { plainEnv } from "./term/mode.ts";
import { printAbove } from "./term/screen.ts";

type Format = Parameters<typeof styleText>[0];

/**
 * Styles text for stdout; plain when stdout is not a TTY, `NO_COLOR` is set, or
 * `--plain` (`ORK_PLAIN`) was given. The environment is read on each call:
 * `--plain` is set after the modules load.
 */
export const style = (format: Format, text: string): string =>
  plainEnv() ? text : styleText(format, text, { stream: process.stdout });

/**
 * Text from outside, fit for a terminal: escape sequences could hide a line on
 * the very screen a person judges from, and a line break could forge one.
 */
export const plain = (text: string): string =>
  stripVTControlCharacters(text).replaceAll(/[\p{Cc}\p{Bidi_Control}]/gu, " ");

/** A line to stdout; above a prompt that is open on the same terminal. */
export const write = (text: string): void => {
  if (process.stdout.isTTY && printAbove(text)) return;
  process.stdout.write(`${text}\n`);
};

export const writeErr = (text: string): void => {
  if (process.stderr.isTTY && printAbove(text)) return;
  process.stderr.write(`${text}\n`);
};

/** What to run to follow, steer or stop the detached run `id` (ADR-081). */
export const detachHint = (id: string): string =>
  `ork attach ${id} · ork logs ${id} -f · ork tree ${id} · ork decide · ork stop ${id}`;

/** What a run spent: `$0.0312`, or `$0.00` for nothing. */
export const cost = (usd: number): string =>
  usd === 0 ? "$0.00" : `$${usd.toFixed(4)}`;

/**
 * Asks a yes-or-no question on the terminal (stderr), through the kit's confirm
 * prompt; anything but yes is no. A trailing `[y/N]` in `question` is dropped:
 * the prompt adds its own.
 */
export const confirm = (question: string): Promise<boolean> =>
  askConfirm(
    { input: process.stdin, output: process.stderr },
    { question: question.replace(/\s*\[y\/N\]\s*$/u, "") },
  );
