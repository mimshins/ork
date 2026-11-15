/**
 * @file `ork <command> --help`: citty's usage, without the flags Ork passes to
 *   itself (the command tree's filter), and with `<command> [flags]` in place
 *   of citty's `a|b|c` list for a command with subcommands, and a long alias
 *   named in its flag's description (citty would print `-watch`, which the
 *   parser reads as `-w -a -t -c -h`). The root command's help is grouped
 *   (`help-root.ts`).
 */

import { type ArgDef, type ArgsDef, type CommandDef, renderUsage } from "citty";

import { argsOf, publicArgs, subcommandsOf } from "./command-tree.ts";
import { GLOBAL_FLAGS, renderRootHelp } from "./help-root.ts";

/** Citty's `a|b|c` usage list of a command's shown subcommands. */
const choicesOf = async (cmd: CommandDef): Promise<string> =>
  (await subcommandsOf(cmd))
    .flatMap(entry => (entry.hidden ? [] : [entry.name].concat(entry.aliases)))
    .join("|");

/** `def` with only its one-letter aliases, and its long ones in its description. */
const shownArg = (def: ArgDef): ArgDef => {
  if (!("alias" in def) || def.alias === undefined) return def;
  const aliases = [def.alias].flat();
  const long = aliases.filter(alias => alias.length > 1);
  if (long.length === 0) return def;
  const also = long.map(alias => `--${alias}`).join(", ");
  return {
    ...def,
    alias: aliases.filter(alias => alias.length === 1),
    description: `${def.description ?? ""}; also ${also}`,
  };
};

/** The usage of `cmd` (under `parent`), as people see it. */
export const renderHelp = async <T extends ArgsDef, P extends ArgsDef>(
  cmd: CommandDef<T>,
  parent?: CommandDef<P>,
): Promise<string> => {
  const shown: CommandDef = {
    args: Object.fromEntries(
      Object.entries(publicArgs(await argsOf(cmd))).map(([name, def]) => [
        name,
        shownArg(def),
      ]),
    ),
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
