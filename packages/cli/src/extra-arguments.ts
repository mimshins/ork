/**
 * @file The citty plugin that refuses a word a command has no positional for
 *   (`ork follow-ups show a b`): citty puts every extra word in `args._`, and a
 *   command that reads one id would act on the first and ignore the rest. It
 *   refuses with citty's own argument error, as `refuseUnknownFlags` does. It
 *   is applied per command, to the ones that take a fixed number of words; a
 *   command that takes trailing words (`validate`, `run`) or reads `args._`
 *   itself does not have it.
 */

import type { CittyPlugin } from "citty";

import { argumentError } from "./argument-error.ts";
import { argsOf } from "./command-tree.ts";

/** Refuses the first word beyond the positionals the command declares. */
export const refuseExtraArguments: CittyPlugin = {
  name: "refuse-extra-arguments",
  setup: async ({ cmd, args }) => {
    const declared = Object.values(await argsOf(cmd)).filter(
      def => def.type === "positional",
    ).length;
    const extra = args._[declared];
    if (extra !== undefined) {
      throw argumentError(`Unexpected argument \`${extra}\`.`);
    }
  },
};
