/**
 * @file The error citty's `runMain` takes for an argument error: the plugins
 *   that refuse a flag (`list/known-flags.ts`) or an extra word
 *   (`extra-arguments.ts`) throw one, so the message is one line and the exit
 *   code is 1, as for a wrong enum value.
 */

import { parseArgs } from "citty";

/**
 * An error citty's `runMain` takes for an argument error (its `CLIError`, which
 * it does not export): a failed parse gives one, and it takes `message`.
 */
export const argumentError = (message: string): Error => {
  try {
    parseArgs([], { x: { type: "string", required: true } });
  } catch (error) {
    if (error instanceof Error) {
      error.message = message;
      return error;
    }
  }
  return new Error(message);
};
