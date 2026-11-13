/**
 * @file A stand-in `ork` for the list-flag completion tests: `ps` and
 *   `follow-ups list` take the flags `filterArgs` makes from their tables.
 */

import {
  followUpListTable,
  runListTable,
  worktreeListTable,
} from "@krapht/ork-core";
import type { CommandDef } from "citty";

import { filterArgs } from "../../src/list/flags.ts";

const noop = (): void => undefined;

/** A root with the list commands, whose flags come from their tables. */
export const listRoot: CommandDef = {
  subCommands: {
    ps: { args: filterArgs(runListTable), run: noop },
    worktrees: {
      subCommands: {
        list: { args: filterArgs(worktreeListTable), run: noop },
      },
    },
    "follow-ups": {
      subCommands: {
        list: {
          args: filterArgs(followUpListTable),
          run: noop,
        },
      },
    },
  },
};
