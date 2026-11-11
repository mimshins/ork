/**
 * @file `ork once -- <command>`: runs a command unless the same check already
 *   passed on identical files, and records a pass (specs/check-once.md). The
 *   command's own output and exit code are `ork once`'s; a hit prints one line
 *   and exits 0. Everything after `--` is the command, so its flags are never
 *   Ork's.
 */

import { spawn } from "node:child_process";

import { runOnce } from "@krapht/ork-core";
import { defineCommand, parseArgs } from "citty";

import { style, write, writeErr } from "../output.ts";
import { ago } from "../runs/format.ts";

const args = {
  as: {
    type: "string",
    description: "The check's name (default: the command's text)",
  },
  covers: {
    type: "string",
    description: "Also record the pass for this name (repeat for more)",
  },
  "with-head": {
    type: "boolean",
    description: "Key the check by HEAD too (for checks relative to it)",
  },
  force: {
    type: "boolean",
    description: "Run even after a pass",
  },
} as const;

/** The command's exit code: a signal or a program that can't start is 1. */
const exitCodeOf = (command: readonly string[]): Promise<number> =>
  new Promise(resolve => {
    const [program = "", ...rest] = command;
    const child = spawn(program, rest, { stdio: "inherit" });
    child.on("error", error => {
      writeErr(`Cannot run ${program}: ${error.message}`);
      resolve(1);
    });
    child.on("close", code => {
      resolve(code ?? 1);
    });
  });

const listOf = (value: unknown): string[] =>
  [value]
    .flat()
    .filter((item): item is string => typeof item === "string" && item !== "");

export const once = defineCommand({
  meta: {
    name: "once",
    description:
      "Run a command unless the same check already passed on these files: ork once [flags] -- <command…>",
  },
  args,
  run: async ({ rawArgs }) => {
    const split = rawArgs.indexOf("--");
    const command = split === -1 ? [] : rawArgs.slice(split + 1);
    if (command.length === 0) {
      writeErr(
        "Say what to run after --: ork once [--as <name>] [--covers <name>] [--with-head] [--force] -- <command…>",
      );
      process.exitCode = 1;
      return;
    }
    // citty must not read the command's own flags as ours.
    const given = parseArgs(rawArgs.slice(0, split), args);
    const run = process.env["ORK_RUN"];
    const node = process.env["ORK_NODE"];
    const result = await runOnce({
      cwd: process.cwd(),
      name: given["as"] ?? command.join(" "),
      covers: listOf(given["covers"]),
      withHead: given["with-head"] === true,
      force: given["force"] === true,
      ...(run === undefined || node === undefined
        ? {}
        : { who: `${run}/${node}` }),
      run: () => exitCodeOf(command),
    });
    if (result.skipped) {
      write(
        `${style("green", "✓")} check already passed on these files · ${ago(result.pass.at)} · ${result.pass.who}`,
      );
    }
    process.exitCode = result.code;
  },
});
