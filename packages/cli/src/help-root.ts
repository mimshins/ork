/**
 * @file `ork --help`: the commands in groups, kubectl-style, each with a short
 *   line, an alias shown beside its command (`worktrees (alias: wt)`), a docs
 *   link at the top, and the usage and version at the foot. Read from the
 *   command tree, so a command in no group is still listed, under "Other".
 */

import type { CommandDef } from "citty";

import { type CommandEntry, resolved, subcommandsOf } from "./command-tree.ts";
import { groupedEntries, groupOf } from "./help-groups.ts";
import { style } from "./output.ts";

/** Where the user docs start. */
export const DOCS_URL =
  "https://github.com/mimshins/ork/blob/main/docs/README.md";

type Row = { name: string; line: string };

const rowOf = (entry: CommandEntry): Row => {
  const short = groupOf(entry.name)?.short ?? entry.description;
  const alias =
    entry.aliases.length === 0 ? "" : ` (alias: ${entry.aliases.join(", ")})`;
  return { name: entry.name, line: `${short}${alias}` };
};

const groupedRows = (
  entries: readonly CommandEntry[],
): { title: string; rows: Row[] }[] =>
  groupedEntries(entries).map(group => ({
    title: group.title,
    rows: group.entries.map(entry => rowOf(entry)),
  }));

/** A group's title, its rows with names `width` wide, and a blank line. */
const groupLines = (
  group: { title: string; rows: Row[] },
  width: number,
): string[] =>
  [style("bold", `${group.title}:`)].concat(
    group.rows.map(
      row => `  ${style("cyan", row.name.padEnd(width))}  ${row.line}`,
    ),
    [""],
  );

/** The root command's help text. */
export const renderRootHelp = async (cmd: CommandDef): Promise<string> => {
  const meta = cmd.meta === undefined ? {} : await resolved(cmd.meta);
  const name = meta.name ?? "ork";
  const groups = groupedRows(await subcommandsOf(cmd));
  const width = Math.max(
    ...groups.flatMap(g => g.rows.map(r => r.name.length)),
  );
  const lines = [
    `${meta.description ?? ""}.`,
    `Docs: ${DOCS_URL}`,
    "",
    ...groups.flatMap(group => groupLines(group, width)),
    `Usage: ${name} <command> [flags]`,
    "",
    `Use "${name} <command> --help" for more about a command.`,
    `${name} v${meta.version ?? ""}`,
  ];
  return lines.join("\n");
};
