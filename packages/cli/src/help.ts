/**
 * @file `ork <command> --help`: citty's usage, without the flags Ork passes to
 *   itself (the command tree's filter), and with `<command> [flags]` in place
 *   of citty's `a|b|c` list for a command with subcommands. The root command's
 *   help is grouped (`help-root.ts`).
 */

import { type ArgsDef, type CommandDef, renderUsage } from "citty";

import { argsOf, publicArgs, subcommandsOf } from "./command-tree.ts";
import { GLOBAL_FLAGS, renderRootHelp } from "./help-root.ts";

/** Citty's `a|b|c` usage list of a command's shown subcommands. */
const choicesOf = async (cmd: CommandDef): Promise<string> =>
  (await subcommandsOf(cmd))
    .flatMap(entry => (entry.hidden ? [] : [entry.name].concat(entry.aliases)))
    .join("|");

/** The usage of `cmd` (under `parent`), as people see it. */
export const renderHelp = async <T extends ArgsDef, P extends ArgsDef>(
  cmd: CommandDef<T>,
  parent?: CommandDef<P>,
): Promise<string> => {
  const shown: CommandDef = {
    args: publicArgs(await argsOf(cmd)),
    ...(cmd.meta === undefined ? {} : { meta: cmd.meta }),
    ...(cmd.subCommands === undefined ? {} : { subCommands: cmd.subCommands }),
  };
  if (cmd.subCommands !== undefined && parent === undefined) {
    return renderRootHelp(shown);
  }
  const above: CommandDef | undefined =
    parent?.meta === undefined ? undefined : { meta: parent.meta };
  const usage = await renderUsage(shown, above);
  const globals = `GLOBAL OPTIONS\n\n${GLOBAL_FLAGS.map(f => `  ${f.name}  ${f.description}`).join("\n")}`;
  if (cmd.subCommands === undefined) return `${usage}\n\n${globals}`;
  const choices = await choicesOf(shown);
  return `${usage
    .replace(` [OPTIONS] ${choices}`, ` <command> [flags]`)
    .replace(` ${choices}`, ` <command> [flags]`)}\n\n${globals}`;
};

/** Prints {@link renderHelp}'s usage, as citty prints its own. */
export const showHelp = async <T extends ArgsDef = ArgsDef>(
  cmd: CommandDef<T>,
  parent?: CommandDef<T>,
): Promise<void> => {
  process.stdout.write(`${await renderHelp(cmd, parent)}\n\n`);
};
