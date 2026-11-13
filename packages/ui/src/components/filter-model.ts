/**
 * @file What the list filter bar knows without drawing (specs/ui/
 *   design-filter-bar.md): the values it holds, the words of its count line,
 *   the CLI command a filter is the twin of, and which field a refused value
 *   was. Pure, so a test needs no React.
 */

import { LIST_FIELD_NAMES, type ListName } from "@krapht/ork-server/client";

/** The applied values by field name; an absent name is unset. */
export type FilterValues = Partial<Record<string, string>>;

/** A list's nouns and the commands that print it. */
type ListWords = {
  /** The bar's name: `Filter runs`. */
  bar: string;
  /** The plural and the singular, as the count line says them. */
  plural: string;
  singular: string;
  /** The list's plain command: the twin of "Clear filter". */
  command: string;
  /** What shows when the fields cannot be read. */
  help: string;
};

export const LIST_WORDS: Record<ListName, ListWords> = {
  runs: {
    bar: "runs",
    plural: "runs",
    singular: "run",
    command: "ork ps",
    help: "ork ps --help",
  },
  decisions: {
    bar: "decisions",
    plural: "decisions",
    singular: "decision",
    command: "ork decide --list",
    help: "ork decide --help",
  },
  "follow-ups": {
    bar: "follow-ups",
    plural: "follow-ups",
    singular: "follow-up",
    command: "ork follow-ups list",
    help: "ork follow-ups list --help",
  },
  feedback: {
    bar: "feedback",
    plural: "feedback items",
    singular: "feedback item",
    command: "ork feedback list",
    help: "ork feedback list --help",
  },
  worktrees: {
    bar: "worktrees",
    plural: "worktrees",
    singular: "worktree",
    command: "ork worktrees list",
    help: "ork worktrees list --help",
  },
  usage: {
    bar: "usage",
    plural: "usage rows",
    singular: "usage row",
    command: "ork usage",
    help: "ork usage --help",
  },
};

/** Whether any field has a value. */
export const isFiltered = (values: FilterValues): boolean =>
  Object.values(values).some(value => value !== undefined && value !== "");

/** The set values as a list route's query: the table's field names. */
export const filterQuery = (values: FilterValues): Record<string, string> =>
  Object.fromEntries(
    Object.entries(values).flatMap(([name, value]) =>
      value === undefined || value === "" ? [] : [[name, value]],
    ),
  );

/** A value as one shell word: bare when safe, else single-quoted. */
const shellWord = (value: string): string =>
  /^[\w@%+=:,./-]+$/u.test(value)
    ? value
    : `'${value.replaceAll("'", `'\\''`)}'`;

/**
 * The command that prints the list as the filter shows it: each set field as
 * `--name value`, in the table's order. A panel's default is never a flag.
 */
export const filterCommand = (list: ListName, values: FilterValues): string =>
  [
    LIST_WORDS[list].command,
    ...LIST_FIELD_NAMES[list].flatMap(name => {
      const value = values[name];
      return value === undefined || value === ""
        ? []
        : [`--${name} ${shellWord(value)}`];
    }),
  ].join(" ");

/** The field a refusal is about, from the `--name` its message starts with. */
export const errorField = (message: string): string | undefined =>
  /^--([a-z][a-z-]*)/u.exec(message)?.[1];

/**
 * The server's refusal of a filter, when `error` is one: the message starts
 * with the flag of one of the list's fields (`--status takes …`); anything else
 * is a failed read.
 */
export const refusalOf = (
  list: ListName,
  error: string,
): { message: string; field: string } | null => {
  const field = errorField(error);
  return field !== undefined && LIST_FIELD_NAMES[list].includes(field)
    ? { message: error, field }
    : null;
};

/** "3 runs match.", "1 run matches.", "No runs match." */
export const matchLine = (list: ListName, shown: number): string => {
  const { plural, singular } = LIST_WORDS[list];
  return shown === 0
    ? `No ${plural} match.`
    : shown === 1
      ? `1 ${singular} matches.`
      : `${String(shown)} ${plural} match.`;
};

/** The values with one field set, or unset when `value` is empty. */
export const withField = (
  values: FilterValues,
  name: string,
  value: string,
): FilterValues => {
  const { [name]: _dropped, ...rest } = values;
  return value === "" ? rest : { ...rest, [name]: value };
};

/** A field's label: its flag's name in sentence case. */
export const labelOf = (name: string): string =>
  `${name.slice(0, 1).toUpperCase()}${name.slice(1)}`;
