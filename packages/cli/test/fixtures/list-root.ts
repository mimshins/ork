/**
 * @file A stand-in `ork` for the list-flag completion tests: `ps` and
 *   `follow-ups list` take the flags `filterArgs` makes from their tables, and
 *   the hidden `--all`, as the real commands will once they are migrated.
 */

import {
  followUpListTable,
  runListTable,
  worktreeListTable,
} from "@krapht/ork-core";
import type { CommandDef } from "citty";

import { allAlias } from "../../src/list/all-alias.ts";
import { filterArgs } from "../../src/list/flags.ts";

const noop = (): void => undefined;

/** A root with the list commands, whose flags come from their tables. */
export const listRoot: CommandDef = {
  subCommands: {
    ps: { args: { ...filterArgs(runListTable), ...allAlias }, run: noop },
    worktrees: {
      subCommands: {
        list: { args: filterArgs(worktreeListTable), run: noop },
      },
    },
    "follow-ups": {
      subCommands: {
        list: {
          args: { ...filterArgs(followUpListTable), ...allAlias },
          run: noop,
        },
      },
    },
  },
};
