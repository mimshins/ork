/**
 * @file Tests for the flags' short forms: every command of the real tree gives
 *   a flag the one letter the table names and no other, the table's letters are
 *   distinct and leave `-h` and `-v` alone, and the raw readers (`--input`,
 *   `--detach`) match both spellings. Through the CLI, `ork decide -f` is
 *   `--follow`, `ork run -d` starts one run in the background (its detached
 *   copy doesn't detach again), and help shows a long alias as `--watch`.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { type CommandTree, commandTree } from "../src/command-tree.ts";
import { main } from "../src/main.ts";
import {
  flagValues,
  isFlag,
  SHORT_FLAGS,
  shortFlagsOf,
} from "../src/short-flags.ts";

const BIN = path.resolve(import.meta.dirname, "../src/bin.ts");

/** `ork <args>` from source in `cwd`, with no terminal; `home` as HOME. */
const ork = (
  args: string[],
  cwd = process.cwd(),
  home?: string,
): { stdout: string; stderr: string } => {
  const done = spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      ORK_PLAIN: "1",
      ORK_NO_UPDATE_CHECK: "1",
      ...(home === undefined ? {} : { HOME: home }),
    },
    input: "",
  });
  return { stdout: done.stdout, stderr: done.stderr };
};

/** A git repository with a one-node shell workflow, `hi.ork.yaml`. */
const shellProject = (): string => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-short-")));
  mkdirSync(path.join(dir, ".ork"));
  writeFileSync(
    path.join(dir, "hi.ork.yaml"),
    'schemaVersion: 1\nname: hi\nnodes:\n  say:\n    type: tool.shell\n    command: "echo hi"\n',
  );
  const git = (...args: string[]): void => {
    execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  };
  git("init", "-q");
  git("add", "-A");
  git(
    "-c",
    "user.email=t@example.com",
    "-c",
    "user.name=t",
    "commit",
    "-qm",
    "i",
  );
  return dir;
};

/** The project's runs, as `<status>`, from `ork ps --json`. */
const statuses = (dir: string): string[] => {
  const rows: unknown = JSON.parse(ork(["ps", "--json"], dir, dir).stdout);
  return Array.isArray(rows)
    ? rows.map((row: { status?: unknown }) => String(row.status))
    : [];
};

/** Each flag of `tree` and below as `<command> --<flag>: <one-letter aliases>`. */
const letters = (tree: CommandTree, at = "ork"): string[] => [
  ...tree.flags.map(
    flag =>
      `${at} --${flag.name}: ${flag.aliases.filter(a => a.length === 1).join(",")}`,
  ),
  ...tree.subcommands.flatMap(sub => letters(sub, `${at} ${sub.name}`)),
];

/** What the table says each flag of `tree` should have. */
const expected = (tree: CommandTree, at = "ork"): string[] => [
  ...tree.flags.map(
    flag => `${at} --${flag.name}: ${SHORT_FLAGS[flag.name] ?? ""}`,
  ),
  ...tree.subcommands.flatMap(sub => expected(sub, `${at} ${sub.name}`)),
];

describe("the short forms", () => {
  it("are the table's letter on every command that has the flag, and no other", async () => {
    const tree = await commandTree(main, "ork");
    expect(letters(tree)).toEqual(expected(tree));
  });

  it("give each letter one flag, and leave -h and -v to help and version", () => {
    const used = Object.values(SHORT_FLAGS);
    expect(new Set(used).size).toBe(used.length);
    expect(used).not.toContain("h");
    expect(used).not.toContain("v");
  });

  it("keep a flag's long alias after its letter", () => {
    expect(
      shortFlagsOf({ follow: { type: "boolean", alias: ["watch"] } }),
    ).toEqual({ follow: { type: "boolean", alias: ["f", "watch"] } });
  });

  it("leave worktrees and wt one command", async () => {
    const tree = await commandTree(main, "ork");
    const names = tree.subcommands.map(sub => [sub.name].concat(sub.aliases));
    expect(names).toContainEqual(["worktrees", "wt"]);
  });
});

describe("reading the raw arguments", () => {
  it("collects a repeatable flag in each spelling", () => {
    expect(
      flagValues(
        ["wf", "--input", "a=1", "--input=b=2", "-i", "c=3", "--node", "x"],
        "input",
      ),
    ).toEqual(["a=1", "b=2", "c=3"]);
  });

  it("collects a flag with no short form by its name only", () => {
    expect(flagValues(["--step", "a", "-s", "b"], "step")).toEqual(["a"]);
  });

  it("knows a boolean flag in both spellings", () => {
    expect(["--detach", "-d", "-f"].map(arg => isFlag(arg, "detach"))).toEqual([
      true,
      true,
      false,
    ]);
  });
});

describe("on the command line", () => {
  it("reads ork decide -f as --follow", () => {
    expect(ork(["decide", "-f"]).stderr).toContain(
      "--follow needs a terminal to answer on",
    );
  });

  it("starts one run in the background with ork run -d", async () => {
    const dir = shellProject();
    expect(ork(["run", "hi.ork.yaml", "-d"], dir, dir).stdout).toContain(
      "started in the background",
    );
    await vi.waitFor(() => {
      expect(statuses(dir)).toEqual(["succeeded"]);
    }, 20_000);
  }, 30_000);

  it("shows a long alias as --watch, not -watch", () => {
    const { stdout } = ork(["decide", "--help"]);
    expect(stdout).toContain("-f, --follow");
    expect(stdout).toContain("also --watch");
    expect(stdout).not.toContain("-watch,");
  });
});
