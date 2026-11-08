/**
 * @file `ork completion <shell>`, which prints a tab-completion script, and the
 *   hidden `ork __complete -- <words…>` the script runs: the candidates for the
 *   last word, one per line. `__complete` reads the command tree and, for
 *   values, the project and the store opened read-only; it never writes, and
 *   prints nothing when anything goes wrong (`bin.ts` runs it before citty, so
 *   a typed `--help` is completed, not obeyed, and without the update check).
 */

import type { EventStore } from "@krapht/ork-core";
import { type CommandDef, defineCommand } from "citty";

import { offerFor, offerLines } from "../completion/candidates.ts";
import { positionOf } from "../completion/position.ts";
import {
  COMPLETE_COMMAND,
  SHELL_SCRIPTS,
  SHELLS,
} from "../completion/scripts.ts";
import { readOnlyStore } from "../completion/sources.ts";
import { VALUE_PROVIDERS } from "../completion/values.ts";
import { writeErr } from "../output.ts";

/**
 * The candidates for the last of `words` (what follows `ork`; the word under
 * the cursor, maybe empty, last), as `__complete` prints them.
 */
export const completionLines = async (
  root: CommandDef,
  words: readonly string[],
  cwd: string,
  storeFile?: string,
): Promise<string[]> => {
  const position = await positionOf(root, words.length === 0 ? [""] : words);
  const opened: { store?: EventStore | undefined } = {};
  const store = (): EventStore | undefined => {
    if (!("store" in opened)) opened.store = readOnlyStore(storeFile);
    return opened.store;
  };
  try {
    return offerLines(
      offerFor(position, VALUE_PROVIDERS, {
        cwd,
        given: position.given,
        current: position.current,
        positionals: position.positionals.map(p => p.name),
        store,
      }),
    );
  } finally {
    opened.store?.close();
  }
};

/** `ork __complete`'s whole job: print the candidates, or nothing. */
export const printCompletions = async (
  root: CommandDef,
  args: readonly string[],
  cwd: string = process.cwd(),
): Promise<void> => {
  try {
    const words = args[0] === "--" ? args.slice(1) : args;
    const lines = await completionLines(root, words, cwd);
    process.stdout.write(lines.map(line => `${line}\n`).join(""));
  } catch {
    // A completion that fails offers nothing, rather than noise in the prompt.
  }
};

/** The hidden `ork __complete` of the command `root`. */
export const completeCommand = (root: CommandDef): CommandDef =>
  defineCommand({
    meta: {
      name: COMPLETE_COMMAND,
      description: "Print tab-completion candidates (the scripts run it)",
      hidden: true,
    },
    run: ({ rawArgs }) => printCompletions(root, rawArgs),
  });

export const completion = defineCommand({
  meta: {
    name: "completion",
    description: `Print a tab-completion script for your shell: ${SHELLS.join(", ")}`,
  },
  args: {
    shell: {
      type: "positional",
      description: SHELLS.join(", "),
      required: true,
    },
  },
  run: ({ args }) => {
    const script = SHELL_SCRIPTS[args.shell];
    if (script === undefined) {
      writeErr(
        `No completion for \`${args.shell}\`; there is one for ${SHELLS.join(", ")}.`,
      );
      process.exitCode = 1;
      return;
    }
    process.stdout.write(script);
  },
});
