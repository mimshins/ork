/**
 * @file Tests for `ork <command> --help`: the flags only Ork passes to itself
 *   are left out, and the commands that take files, tools or runs say so; `ork
 *   --help` lists every command in exactly one group, and a command with
 *   subcommands shows `<command> [flags]`.
 */

import { stripVTControlCharacters } from "node:util";

import type { ArgsDef, CommandDef } from "citty";
import { describe, expect, it } from "vitest";

import { apply } from "../src/commands/feedback-loop.ts";
import {
  feedback,
  HELP_GROUPS,
  INTERNAL,
  link,
  main,
  renderHelp,
  resume,
  run,
  subcommandsOf as entriesOf,
  validate,
} from "../src/index.ts";

const help = async <T extends ArgsDef, P extends ArgsDef>(
  cmd: CommandDef<T>,
  parent?: CommandDef<P>,
) => stripVTControlCharacters(await renderHelp(cmd, parent));

/** The subcommands a command's description names, after its colon. */
const named = async (cmd: CommandDef): Promise<string[]> => {
  const meta = await cmd.meta;
  const description = typeof meta === "object" ? meta.description : "";
  return (description ?? "").split(": ").at(1)?.split(", ").toSorted() ?? [];
};

/** The names of the commands `ork --help` lists: shown ones, not aliases. */
const listedCommands = async (): Promise<string[]> =>
  (await entriesOf(main))
    .filter(entry => !entry.hidden)
    .map(entry => entry.name)
    .toSorted();

/** The definition of `ork`'s subcommand `name`. */
const subcommandNamed = async (name: string): Promise<CommandDef> =>
  (await entriesOf(main)).find(entry => entry.name === name)?.def ?? main;

/** Every name in the help groups, as often as it appears. */
const groupedNames = (): string[] =>
  HELP_GROUPS.flatMap(group => group.commands.map(c => c.name)).toSorted();

/** The names of a command's subcommands. */
const subcommandsOf = async (cmd: CommandDef): Promise<string[]> =>
  Object.keys((await cmd.subCommands) ?? {}).toSorted();

describe("ork --help", () => {
  it("leaves out the flags only Ork passes to itself", async () => {
    const text = await help(run);
    expect(text).not.toContain(INTERNAL);
    expect(text).not.toContain("--run-id");
    expect(text).not.toContain("--expect-workflow");
    expect(text).toContain("--detach");
    const nested = await help(apply, feedback);
    expect(nested).toContain("USAGE feedback apply");
    expect(nested).not.toContain("--run-id");
  });

  it("says validate takes files and link takes tools", async () => {
    expect(await help(validate, main)).toContain(
      "USAGE ork validate [OPTIONS] [FILES]",
    );
    expect(await help(link, main)).toContain(
      "USAGE ork link [OPTIONS] [TOOLS]",
    );
  });

  it("says resume takes any run that didn't succeed", async () => {
    expect(await help(resume, main)).toContain(
      "Continue a run that didn't succeed (stopped, failed or crashed)",
    );
  });

  it("names every feedback subcommand in its summary", async () => {
    expect(await named(feedback)).toEqual(await subcommandsOf(feedback));
  });
});

describe("ork --help, grouped", () => {
  it("puts every command of ork in exactly one group", async () => {
    expect(groupedNames()).toEqual(await listedCommands());
  });

  it("lists the groups in order, with the docs link and the usage", async () => {
    const text = await help(main);
    const titles = HELP_GROUPS.map(group => `${group.title}:`);
    const at = titles.map(title => text.indexOf(`\n${title}\n`));
    expect(at.every(index => index > 0)).toBe(true);
    expect(at).toEqual(at.toSorted((a, b) => a - b));
    expect(text).toMatch(
      /^Orchestrate Claude agents on your machine\.\nDocs: https:/u,
    );
    expect(text).toContain("Usage: ork <command> [flags]");
    expect(text).toContain(
      'Use "ork <command> --help" for more about a command.',
    );
    expect(text).toMatch(/\nork v\d/u);
  });

  it("shows wt beside worktrees, never on its own row, and hides __complete", async () => {
    const text = await help(main);
    expect(text).toMatch(/\n {2}worktrees +\S.*\(alias: wt\)\n/u);
    expect(text).not.toMatch(/\n {2}wt /u);
    expect(text).not.toContain("__complete");
    expect(text).not.toContain(INTERNAL);
  });

  it("gives a command with subcommands a short usage line", async () => {
    const text = await help(await subcommandNamed("worktrees"), main);
    expect(text).toContain("USAGE ork worktrees <command> [flags]");
    expect(text).not.toContain("list|clean|remove");
    expect(await help(feedback, main)).toContain(
      "USAGE ork feedback <command> [flags]",
    );
  });
});
