/**
 * @file The citty plugin that refuses a flag a list command does not have (`ork
 *   ps --bogus`, `ork decide --list --since 24h`). citty's parser is not
 *   strict: it puts an unknown `--since 24h` into the arguments as `since:
 *   true` plus a positional, which `decide` would read as a run id. The plugin
 *   runs before the command, on the nine list commands only (specs/cli/
 *   list-filters.md), and refuses with citty's own argument error, so the
 *   one-line message and exit code 1 are the same as for a wrong enum value.
 */

import { type CittyPlugin, parseArgs } from "citty";

import { argsOf, resolved } from "../command-tree.ts";

/** Names citty reads without the command declaring them. */
const BUILT_IN = new Set(["_", "help", "h"]);

/** A flag's name without its spelling: `run-id`, `runId` and `run_id` agree. */
const spelling = (name: string): string =>
  name.replaceAll(/[-_]/gu, "").toLowerCase();

/**
 * An error citty's `runMain` takes for an argument error (its `CLIError`, which
 * it does not export): a failed parse gives one, and it takes `message`.
 */
const argumentError = (message: string): Error => {
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

/** How the flag is typed: `--since`, or `-x` for a one-letter name. */
const written = (name: string): string =>
  name.length === 1 ? `-${name}` : `--${name}`;

/** Refuses the first flag the command does not declare. */
export const refuseUnknownFlags: CittyPlugin = {
  name: "refuse-unknown-flags",
  setup: async ({ cmd, rawArgs, args }) => {
    // A command with subcommands (`projects`) hands the rest to one of them.
    const [first] = rawArgs;
    const subs = await resolved(cmd.subCommands ?? {});
    if (first !== undefined && first in subs) return;
    const known = new Set<string>();
    for (const [name, def] of Object.entries(await argsOf(cmd))) {
      known.add(spelling(name));
      if ("alias" in def && def.alias !== undefined) {
        for (const alias of [def.alias].flat()) known.add(spelling(alias));
      }
    }
    const unknown = Object.keys(args).find(
      key => !BUILT_IN.has(key) && !known.has(spelling(key)),
    );
    if (unknown !== undefined) {
      throw argumentError(`Unknown flag \`${written(unknown)}\`.`);
    }
  },
};
