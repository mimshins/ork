/**
 * @file `ork <command> --help`: citty's usage, without the flags Ork passes to
 *   itself. A flag whose description starts with `Internal:` (the run id
 *   `--detach` picked, the caller of a `workflow.call`, …) still works, but is
 *   not shown to people.
 */

import {
  type ArgsDef,
  type CommandDef,
  renderUsage,
  type Resolvable,
} from "citty";

/** How a flag that only Ork passes to itself starts its description. */
export const INTERNAL = "Internal:";

/** Whether citty was given a function that gives the value. */
const isThunk = <T>(
  value: Resolvable<T>,
): value is (() => T) | (() => Promise<T>) => typeof value === "function";

/** A command's flags, which citty lets be given as a function. */
const argsOf = <T extends ArgsDef>(
  cmd: CommandDef<T>,
): ArgsDef | Promise<ArgsDef> => {
  const { args } = cmd;
  if (args === undefined) return {};
  return isThunk(args) ? args() : args;
};

/** `args` without the flags only Ork passes to itself. */
export const publicArgs = (args: ArgsDef): ArgsDef =>
  Object.fromEntries(
    Object.entries(args).filter(
      ([, def]) => !(def.description ?? "").startsWith(INTERNAL),
    ),
  );

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
  const above: CommandDef | undefined =
    parent?.meta === undefined ? undefined : { meta: parent.meta };
  return renderUsage(shown, above);
};

/** Prints {@link renderHelp}'s usage, as citty prints its own. */
export const showHelp = async <T extends ArgsDef = ArgsDef>(
  cmd: CommandDef<T>,
  parent?: CommandDef<T>,
): Promise<void> => {
  process.stdout.write(`${await renderHelp(cmd, parent)}\n\n`);
};
