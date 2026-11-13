/**
 * @file Where the cursor is in a command line being typed: which command the
 *   words before it reach, what was given so far, and what the last word is (a
 *   subcommand or positional, a flag, or a flag's value). Words are parsed the
 *   way citty parses them: a flag that takes a value takes the next word,
 *   unless it is written `--flag=value`; a last word written that way is that
 *   flag's value, with `--flag=` kept as its prefix.
 */

import type { CommandDef } from "citty";

import {
  argInfoOf,
  type CommandEntry,
  findEntry,
  type FlagInfo,
  type PositionalInfo,
  subcommandsOf,
} from "../command-tree.ts";

/** What the word under the cursor is. */
export type Slot =
  /** A subcommand, or the positional at `positional` (when there is one). */
  | { kind: "word"; positional?: PositionalInfo }
  /** A flag's name. */
  | { kind: "flag" }
  /**
   * The value of `flag`. `prefix` is the `--flag=` already typed, when the
   * value is written in that form; each candidate then carries it.
   */
  | { kind: "value"; flag: FlagInfo; prefix?: string };

/** The command reached, what was given, and the word under the cursor. */
export type Position = {
  /** The command names from the root, `["worktrees", "remove"]`. */
  path: string[];
  subcommands: CommandEntry[];
  flags: FlagInfo[];
  positionals: PositionalInfo[];
  /** Positionals and flag values given before the cursor, by name. */
  given: Record<string, string>;
  /** How many positionals of the reached command were given. */
  index: number;
  /** The word under the cursor, as typed so far. */
  current: string;
  slot: Slot;
};

const flagNamed = (
  flags: readonly FlagInfo[],
  word: string,
): FlagInfo | undefined => {
  const name = word.replace(/^-{1,2}/u, "").split("=")[0] ?? "";
  return flags.find(
    flag =>
      flag.name === name ||
      flag.aliases.includes(name) ||
      (flag.negatable && name === `no-${flag.name}`),
  );
};

type Walk = Omit<Position, "current" | "slot"> & {
  /** A flag before the cursor still waiting for its value. */
  pending?: FlagInfo;
  /** Past `--`: every word is a positional. */
  rest: boolean;
};

/** One word before the cursor, folded into the walk. */
const step = async (walk: Walk, word: string): Promise<Walk> => {
  const { pending, ...settled } = walk;
  if (pending !== undefined) {
    return { ...settled, given: { ...walk.given, [pending.name]: word } };
  }
  if (!walk.rest && word === "--") return { ...walk, rest: true };
  if (!walk.rest && word.startsWith("-")) {
    const flag = flagNamed(walk.flags, word);
    if (flag === undefined || !flag.takesValue) return walk;
    if (!word.includes("=")) return { ...walk, pending: flag };
    const value = word.slice(word.indexOf("=") + 1);
    return { ...walk, given: { ...walk.given, [flag.name]: value } };
  }
  const sub = walk.index === 0 ? findEntry(walk.subcommands, word) : undefined;
  if (sub !== undefined) {
    return {
      ...(await argInfoOf(sub.def)),
      path: [...walk.path, sub.name],
      subcommands: await subcommandsOf(sub.def),
      given: walk.given,
      index: 0,
      rest: false,
    };
  }
  const positional = walk.positionals[walk.index];
  const given =
    positional === undefined
      ? walk.given
      : { ...walk.given, [positional.name]: word };
  return { ...walk, given, index: walk.index + 1 };
};

/** `--flag=` of a typed `--flag=text` whose flag takes a value, else nothing. */
const valuePrefixOf = (walk: Walk, typed: string): string | undefined => {
  if (walk.pending !== undefined || walk.rest || !typed.startsWith("-")) {
    return undefined;
  }
  const at = typed.indexOf("=");
  const flag = at < 0 ? undefined : flagNamed(walk.flags, typed);
  return flag?.takesValue === true ? typed.slice(0, at + 1) : undefined;
};

const slotOf = (
  walk: Walk,
  typed: string,
  prefix: string | undefined,
): Slot => {
  if (walk.pending !== undefined) return { kind: "value", flag: walk.pending };
  if (prefix !== undefined) {
    const flag = flagNamed(walk.flags, prefix);
    if (flag !== undefined) return { kind: "value", flag, prefix };
  }
  if (!walk.rest && typed.startsWith("-")) return { kind: "flag" };
  const positional = walk.positionals[walk.index];
  return positional === undefined
    ? { kind: "word" }
    : { kind: "word", positional };
};

/**
 * Where `words` (what follows `ork`, the word under the cursor last, maybe
 * empty) leave the cursor, in the command `root`.
 */
export const positionOf = async (
  root: CommandDef,
  words: readonly string[],
): Promise<Position> => {
  const before = words.slice(0, -1);
  const typed = words.at(-1) ?? "";
  const start: Walk = {
    ...(await argInfoOf(root)),
    path: [],
    subcommands: await subcommandsOf(root),
    given: {},
    index: 0,
    rest: false,
  };
  // Each word depends on the one before: folded in order.
  const walk = await before.reduce<Promise<Walk>>(
    async (previous, word) => step(await previous, word),
    Promise.resolve(start),
  );
  const { pending: _pending, rest: _rest, ...reached } = walk;
  const prefix = valuePrefixOf(walk, typed);
  const current = prefix === undefined ? typed : typed.slice(prefix.length);
  return { ...reached, current, slot: slotOf(walk, typed, prefix) };
};
