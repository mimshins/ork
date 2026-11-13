/**
 * @file What `ork __complete` offers at a position: subcommands (the root's in
 *   `ork --help`'s groups), a command's public flags, an argument's values from
 *   its provider, or an enum flag's values (also when written `--flag=value`,
 *   each candidate then keeping `--flag=`); filtered by what was typed, and
 *   printed one per line as `value<TAB>description`, with `:group <title>`
 *   before each group and `:files` when file names fit too.
 */

import { groupedEntries, groupOf } from "../help-groups.ts";
import type { Position } from "./position.ts";
import type { Candidate } from "./sources.ts";
import {
  providerFor,
  type ValueContext,
  type ValueProvider,
} from "./values.ts";

/** Candidates under one title. */
export type Section = { title: string; candidates: Candidate[] };

/** What to offer: sections in order, and whether file names fit too. */
export type Offer = { sections: Section[]; files: boolean };

const NONE: Offer = { sections: [], files: false };

/** The first line of a description, as a menu shows it. */
const brief = (text: string): string => text.split("\n")[0]?.trim() ?? "";

const subcommandSections = (position: Position): Section[] => {
  if (position.path.length > 0) {
    const candidates = position.subcommands
      .filter(entry => !entry.hidden)
      .map(entry => ({
        value: entry.name,
        description: brief(entry.description),
      }));
    return [{ title: "commands", candidates }];
  }
  return groupedEntries(position.subcommands).map(group => ({
    title: group.title,
    candidates: group.entries.map(entry => ({
      value: entry.name,
      description: groupOf(entry.name)?.short ?? brief(entry.description),
    })),
  }));
};

const flagSection = (position: Position): Section => ({
  title: "flags",
  candidates: [
    ...position.flags.flatMap(flag => [
      { value: `--${flag.name}`, description: brief(flag.description) },
      ...(flag.negatable
        ? [
            {
              value: `--no-${flag.name}`,
              description: `Turn off --${flag.name}`,
            },
          ]
        : []),
    ]),
    { value: "--plain", description: "Plain output, no color or redraw" },
    { value: "--help", description: "Show this command's help" },
  ],
});

const fromProvider = (
  provider: ValueProvider | undefined,
  context: ValueContext,
): Offer =>
  provider === undefined
    ? NONE
    : {
        sections: [
          { title: provider.group, candidates: provider.values(context) },
        ],
        files: provider.files === true,
      };

/** Everything that fits at `position`, before filtering. */
const offerAt = (
  position: Position,
  providers: Readonly<Record<string, ValueProvider>>,
  context: ValueContext,
): Offer => {
  const { slot, path } = position;
  if (slot.kind === "flag")
    return { sections: [flagSection(position)], files: false };
  if (slot.kind === "value") {
    const { flag } = slot;
    if (flag.options.length > 0) {
      const candidates = flag.options.map(value => ({
        value,
        description: "",
      }));
      return { sections: [{ title: flag.name, candidates }], files: false };
    }
    return fromProvider(providerFor(providers, path, flag.name), context);
  }
  const values =
    slot.positional === undefined
      ? NONE
      : fromProvider(
          providerFor(providers, path, slot.positional.name),
          context,
        );
  const commands = position.index === 0 ? subcommandSections(position) : [];
  return { sections: [...commands, ...values.sections], files: values.files };
};

/** What fits at `position`, keeping what starts with the typed word. */
export const offerFor = (
  position: Position,
  providers: Readonly<Record<string, ValueProvider>>,
  context: ValueContext,
): Offer => {
  const offer = offerAt(position, providers, context);
  // A value typed as `--flag=text` keeps `--flag=`, so a shell that replaces
  // the whole word (zsh, fish) gets it back.
  const prefix =
    position.slot.kind === "value" ? (position.slot.prefix ?? "") : "";
  const sections = offer.sections
    .map(section => ({
      ...section,
      candidates: section.candidates
        .filter(c => c.value.startsWith(position.current))
        .map(c => ({
          value: `${prefix}${c.value}`,
          description: c.description,
        })),
    }))
    .filter(section => section.candidates.length > 0);
  return { sections, files: offer.files };
};

/**
 * A value a shell may insert as it is: no space, control character, quote or
 * shell syntax (`$(…)`, `;`, `*`), and no leading `:`, which would read as one
 * of this output's own lines. Ids, names and flags all fit.
 */
const SAFE_VALUE = /^[\w.@+,=/~-][\w.@+,=/~:-]*$/u;

/** One line per candidate, unsafe values dropped; descriptions on one line. */
export const offerLines = (offer: Offer): string[] => [
  ...offer.sections.flatMap(section => [
    `:group ${section.title}`,
    ...section.candidates
      .filter(c => SAFE_VALUE.test(c.value))
      .map(c => `${c.value}\t${c.description.replaceAll(/\p{Cc}+/gu, " ")}`),
  ]),
  ...(offer.files ? [":files"] : []),
];
