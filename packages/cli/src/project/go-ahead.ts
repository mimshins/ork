/**
 * @file The question `ork worktrees clean` and `remove` ask before they act:
 *   skipped with `--yes`, impossible without a terminal (so `--yes` is needed),
 *   and a no says so rather than leaving the command silent.
 */

import { confirm, write, writeErr } from "../output.ts";

/** Whether to carry on; says why not when it won't. */
export const goAhead = async (
  yes: boolean,
  verb: string,
  terminal: boolean = process.stdin.isTTY,
  ask: (question: string) => Promise<boolean> = confirm,
): Promise<boolean> => {
  if (yes) return true;
  if (!terminal) {
    writeErr(`Pass --yes to ${verb} without a terminal.`);
    process.exitCode = 1;
    return false;
  }
  if (await ask("Go ahead?")) return true;
  write("Cancelled.");
  return false;
};
