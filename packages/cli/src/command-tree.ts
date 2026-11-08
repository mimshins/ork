/**
 * @file The `ork` command tree, read from citty's definitions: each command's
 *   name, description, aliases, public flags and positionals, and its
 *   subcommands, with the ones loaded on use resolved. `--help` and tab
 *   completion both read it, so a new command or flag shows up in both with no
 *   change here. A flag whose description starts with `Internal:` (one Ork
 *   passes to itself) still works but is left out.
 */

import type { ArgDef, ArgsDef, CommandDef, Resolvable } from "citty";

/** How a flag that only Ork passes to itself starts its description. */
export const INTERNAL = "Internal:";

/** Whether citty was given a function that gives the value. */
const isThunk = <T>(
  value: Resolvable<T>,
): value is (() => T) | (() => Promise<T>) => typeof value === "function";

/** A value citty lets be given as is, as a promise, or as a function. */
export const resolved = <T>(value: Resolvable<T>): Promise<T> =>
  Promise.resolve(isThunk(value) ? value() : value);

/** `args` without the flags only Ork passes to itself. */
export const publicArgs = (args: ArgsDef): ArgsDef =>
  Object.fromEntries(
    Object.entries(args).filter(
      ([, def]) => !(def.description ?? "").startsWith(INTERNAL),
    ),
  );

/** A command's flags and positionals, which citty lets be given lazily. */
export const argsOf = <T extends ArgsDef>(
  cmd: CommandDef<T>,
): Promise<ArgsDef> =>
  cmd.args === undefined ? Promise.resolve({}) : resolved<ArgsDef>(cmd.args);

/** A flag, as completion and help show it. */
export type FlagInfo = {
  /** The name after `--`. */
  name: string;
  description: string;
  /** Whether it takes a value (`--node <id>`). */
  takesValue: boolean;
  /** One-letter and other names (`-f`). */
  aliases: string[];
  /** An enum flag's values. */
  options: string[];
  /** A boolean on by default, which `--no-<name>` turns off. */
  negatable: boolean;
};

/** A positional argument, in order. */
export type PositionalInfo = { name: string; description: string };

/** One subcommand: the name it is listed under and its definition. */
export type CommandEntry = {
  name: string;
  /** Other names for the same command (`wt` for `worktrees`). */
  aliases: string[];
  description: string;
  /** Hidden from `--help` and completion (`__complete`). */
  hidden: boolean;
  def: CommandDef;
};

/** A command and everything under it. */
export type CommandTree = Omit<CommandEntry, "def"> & {
  flags: FlagInfo[];
  positionals: PositionalInfo[];
  subcommands: CommandTree[];
};

const listOf = (value: string | string[] | undefined): string[] =>
  value === undefined ? [] : [value].flat();

const flagOf = (name: string, def: ArgDef): FlagInfo => ({
  name,
  description: def.description ?? "",
  takesValue: def.type === "string" || def.type === "enum",
  aliases: "alias" in def ? listOf(def.alias) : [],
  options: def.type === "enum" ? (def.options ?? []) : [],
  negatable: def.type === "boolean" && def.default === true,
});

/** A command's public flags and positionals, in the order it defines them. */
export const argInfoOf = async (
  cmd: CommandDef,
): Promise<{ flags: FlagInfo[]; positionals: PositionalInfo[] }> => {
  const entries = Object.entries(publicArgs(await argsOf(cmd)));
  return {
    flags: entries
      .filter(([, def]) => def.type !== "positional")
      .map(([name, def]) => flagOf(name, def)),
    positionals: entries
      .filter(([, def]) => def.type === "positional")
      .map(([name, def]) => ({ name, description: def.description ?? "" })),
  };
};

/**
 * A command's subcommands, in order, loaded ones resolved. A name whose
 * definition is one listed before it (`wt`, `worktrees`'s) is an alias of that
 * one, not an entry of its own.
 */
export const subcommandsOf = async (
  cmd: CommandDef,
): Promise<CommandEntry[]> => {
  const subs =
    cmd.subCommands === undefined ? {} : await resolved(cmd.subCommands);
  const loaded = await Promise.all(
    Object.entries(subs).map(async ([name, sub]) => {
      const def = await resolved(sub);
      const meta = def.meta === undefined ? {} : await resolved(def.meta);
      return { name, def, meta };
    }),
  );
  const entries: CommandEntry[] = [];
  for (const { name, def, meta } of loaded) {
    const same = entries.find(entry => entry.def === def);
    if (same === undefined) {
      entries.push({
        name,
        aliases: listOf(meta.alias),
        description: meta.description ?? "",
        hidden: meta.hidden === true,
        def,
      });
    } else same.aliases.push(name);
  }
  return entries;
};

/** The subcommand `name` (or one of its aliases) of `entries`. */
export const findEntry = (
  entries: readonly CommandEntry[],
  name: string,
): CommandEntry | undefined =>
  entries.find(entry => entry.name === name || entry.aliases.includes(name));

/** The whole tree under `entry`. */
export const treeOf = async (entry: CommandEntry): Promise<CommandTree> => {
  const { def, ...rest } = entry;
  const children = await subcommandsOf(def);
  return {
    ...rest,
    ...(await argInfoOf(def)),
    subcommands: await Promise.all(children.map(child => treeOf(child))),
  };
};

/** The tree of the root command `cmd`, named `name`. */
export const commandTree = async (
  cmd: CommandDef,
  name: string,
): Promise<CommandTree> => {
  const meta = cmd.meta === undefined ? {} : await resolved(cmd.meta);
  return treeOf({
    name,
    aliases: [],
    description: meta.description ?? "",
    hidden: false,
    def: cmd,
  });
};
