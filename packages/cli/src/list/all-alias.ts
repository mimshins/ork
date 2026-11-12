/**
 * @file The deprecated `--all` of `ps`, `usage`, `decide`, `follow-ups list`
 *   and `feedback list` (RFC-017): it stands for `--project all` or `--status
 *   all`, is left out of `--help` and Tab completion (an `Internal:` flag), and
 *   warns once on stderr. `prune --all` is not this one.
 */

import { INTERNAL } from "../command-tree.ts";
import { writeErr } from "../output.ts";

/** The flag `--all` stands for. */
export type AllAlias = "project" | "status";

/** The hidden `--all` flag, for a command's `args`. */
export const allAlias = {
  all: {
    type: "boolean",
    description: `${INTERNAL} deprecated, use --project all or --status all`,
    default: false,
  },
} as const;

/**
 * `args` with `all` in `--all`'s place when `--all` was given and that flag was
 * not (a given one wins); the warning prints either way. `args` as is when
 * `--all` was not given.
 */
export const warnAll = (
  args: Readonly<Record<string, unknown>>,
  flag: AllAlias,
): Readonly<Record<string, unknown>> => {
  if (args["all"] !== true) return args;
  writeErr(`--all is deprecated; use --${flag} all.`);
  return args[flag] === undefined ? { ...args, [flag]: "all" } : args;
};
