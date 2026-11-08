/**
 * @file Tests that what completion offers is safe to put on a command line: a
 *   workflow's keys that aren't node ids, and file names with shell syntax, are
 *   never offered; and the bash script, run by the system's bash with a
 *   stand-in `ork`, keeps each candidate whole (no joining, splitting or
 *   globbing) and offers only what follows a typed `ork:`.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { SHELL_SCRIPTS } from "../src/completion/scripts.ts";
import { completionLines, main } from "../src/index.ts";
import { seedProject, tempDir } from "./fixtures/completion.ts";

const CRAFTED = [
  "schemaVersion: 1",
  "name: crafted",
  "nodes:",
  "  plan:",
  "    type: tool.shell",
  '    command: "echo plan"',
  '  "a\\n:files":',
  "    type: tool.shell",
  '    command: "echo a"',
  '  "b\\tc":',
  "    type: tool.shell",
  '    command: "echo b"',
  '  "$(touch x)":',
  "    type: tool.shell",
  '    command: "echo x"',
  "",
].join("\n");

/** A project with the crafted workflow and a file named with shell syntax. */
const craftedProject = (): string => {
  const project = seedProject();
  const folder = path.join(project, ".ork", "workflows");
  writeFileSync(path.join(folder, "crafted.ork.yaml"), CRAFTED);
  writeFileSync(path.join(folder, "$(id).ork.yaml"), CRAFTED);
  return project;
};

const BASH = "/bin/bash";

/** What the system's bash completes for `line`, with `ork` a stand-in. */
const bashCompletes = (line: string, printed: string): string[] => {
  const dir = tempDir("ork-complete-bash-");
  const bin = path.join(dir, "bin");
  const cwd = path.join(dir, "cwd");
  mkdirSync(bin);
  mkdirSync(cwd);
  // A file a glob of `ork:a*b` would match, and `compgen -f` finds.
  writeFileSync(path.join(cwd, "ork:axb"), "");
  writeFileSync(path.join(bin, "ork"), `#!/bin/sh\nprintf '${printed}'\n`, {
    mode: 0o755,
  });
  writeFileSync(path.join(dir, "ork.bash"), SHELL_SCRIPTS["bash"] ?? "");
  const run = [
    "shopt -s nullglob failglob",
    'source "$1"',
    'COMP_LINE="$2"',
    "COMP_POINT=${#COMP_LINE}",
    "_ork",
    'printf "%s\\n" "${COMPREPLY[@]}"',
  ].join("\n");
  const result = spawnSync(
    BASH,
    ["-c", run, "_", path.join(dir, "ork.bash"), line],
    {
      cwd,
      encoding: "utf8",
      env: { PATH: `${bin}:/usr/bin:/bin`, HOME: dir },
    },
  );
  return result.stdout.split("\n").filter(Boolean).toSorted();
};

describe("safe candidates", () => {
  it("offers only a workflow's keys that are node ids", async () => {
    const lines = await completionLines(
      main,
      ["run", "crafted", "--node", ""],
      craftedProject(),
      "/none",
    );
    expect(lines).toEqual([":group nodes", "plan\tcrafted"]);
  });

  it("never offers a file name with shell syntax", async () => {
    const lines = await completionLines(
      main,
      ["run", ""],
      craftedProject(),
      "/none",
    );
    expect(lines.join("\n")).not.toContain("$(id)");
    expect(lines).toContain("crafted\tthis project's workflow");
  });
});

describe.skipIf(!existsSync(BASH))("the bash script", () => {
  it("keeps every candidate whole, globs untouched, after `ork:`", () => {
    const printed = String.raw`:group workflows\nork:feature\tone\nork:a*b\ttwo\nork:qa-pass\tthree\n:files\n`;
    expect(bashCompletes("ork run ork:", printed)).toEqual([
      "a*b",
      "axb",
      "feature",
      "qa-pass",
    ]);
  });

  it("offers several plain candidates as several", () => {
    const printed = String.raw`:group commands\nlist\tone\nclean\ttwo\nremove\tthree\n`;
    expect(bashCompletes("ork worktrees ", printed)).toEqual([
      "clean",
      "list",
      "remove",
    ]);
  });
});
