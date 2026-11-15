/**
 * @file The one-letter short forms of Ork's flags (specs/cli.md#short-flags):
 *   one table, so a letter means the same flag in every command that has it,
 *   and no command declares its own. `withShortFlags` gives them to the whole
 *   command tree, commands loaded on use too, so help, completion and the
 *   parser all see them. Code that reads the raw arguments itself (the
 *   repeatable `--input`, the `--detach` a detached run drops) matches both
 *   spellings with `isFlag` and `flagValues`.
 */

import type { ArgDef, ArgsDef, CommandDef } from "citty";

import { resolved } from "./command-tree.ts";

/**
 * Each flag's short form. A letter is given only where a well-known CLI uses it
 * for the same thing (`tail -f`, `git commit -m`, `head -n`); `-h` and `-v` are
 * help and version, and `-s` is no one's, as `--since`, `--status` and
 * `--severity` would all want it.
 */
export const SHORT_FLAGS: Readonly<Record<string, string>> = {
  all: "a",
  detach: "d",
  follow: "f",
  input: "i",
  limit: "n",
  message: "m",
  output: "o",
  project: "p",
  yes: "y",
};

/** `def` with `short` first among its aliases. */
const withAlias = (def: ArgDef, short: string): ArgDef => {
  if (def.type === "positional") return def;
  const given = "alias" in def ? [def.alias ?? []].flat() : [];
  return { ...def, alias: [short, ...given.filter(alias => alias !== short)] };
};

/** `args` with each flag's short form from {@link SHORT_FLAGS}. */
export const shortFlagsOf = <T extends ArgsDef>(args: T): T => {
  const out = { ...args };
  for (const [name, def] of Object.entries(args)) {
    const short = SHORT_FLAGS[name];
    if (short !== undefined) Reflect.set(out, name, withAlias(def, short));
  }
  return out;
};

/** Each subcommand wrapped once, so `worktrees` and `wt` stay one command. */
const wrapped = new WeakMap<CommandDef, CommandDef>();

const wrappedOnce = (cmd: CommandDef): CommandDef => {
  const known = wrapped.get(cmd);
  if (known !== undefined) return known;
  const out = withShortFlags(cmd);
  wrapped.set(cmd, out);
  return out;
};

/**
 * `cmd` and every command under it, loaded on use or not, with their flags'
 * short forms.
 */
export const withShortFlags = <T extends ArgsDef>(
  cmd: CommandDef<T>,
): CommandDef<T> => {
  const { args, subCommands } = cmd;
  return {
    ...cmd,
    ...(args === undefined
      ? {}
      : { args: async (): Promise<T> => shortFlagsOf(await resolved(args)) }),
    ...(subCommands === undefined
      ? {}
      : {
          subCommands: async () =>
            Object.fromEntries(
              Object.entries(await resolved(subCommands)).map(([name, sub]) => [
                name,
                async (): Promise<CommandDef> =>
                  wrappedOnce(await resolved(sub)),
              ]),
            ),
        }),
  };
};

/** The spellings of the flag `--name` on a command line. */
const spellingsOf = (name: string): string[] => {
  const short = SHORT_FLAGS[name];
  return short === undefined ? [`--${name}`] : [`--${name}`, `-${short}`];
};

/** Whether `arg` is the flag `--name` (a boolean), in either spelling. */
export const isFlag = (arg: string, name: string): boolean =>
  spellingsOf(name).includes(arg);

/**
 * Every value given to the flag `--name` in `rawArgs`, in order: `--name v`,
 * `--name=v`, `-x v` and `-x=v` for its short form `-x`.
 */
export const flagValues = (
  rawArgs: readonly string[],
  name: string,
): string[] => {
  const spellings = spellingsOf(name);
  const values: string[] = [];
  for (const [index, arg] of rawArgs.entries()) {
    const joined = spellings.find(flag => arg.startsWith(`${flag}=`));
    if (joined !== undefined) values.push(arg.slice(joined.length + 1));
    else if (spellings.includes(arg)) {
      const value = rawArgs[index + 1];
      if (value !== undefined) values.push(value);
    }
  }
  return values;
};
