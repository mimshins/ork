/**
 * @file Tests for `ork <command> --help`: the flags only Ork passes to itself
 *   are left out, and the commands that take files, tools or runs say so.
 */

import { stripVTControlCharacters } from "node:util";

import type { ArgsDef, CommandDef } from "citty";
import { describe, expect, it } from "vitest";

import { apply } from "../src/commands/feedback-loop.ts";
import {
  feedback,
  INTERNAL,
  link,
  main,
  renderHelp,
  resume,
  run,
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
