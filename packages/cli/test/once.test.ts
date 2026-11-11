/**
 * @file The real `ork once`: it runs a command once per set of files, says so
 *   in one line on a hit, runs again after an edit, `--force` or
 *   `ORK_ONCE=off`, `--covers` records a pass for another name, a failing
 *   command records nothing, and `--help` and completion list it.
 */

import { execFileSync, spawnSync } from "node:child_process";
import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const BIN = path.resolve(import.meta.dirname, "../src/bin.ts");
const HIT = /^✓ check already passed on these files · .+ · you\n$/u;

let repo = "";

const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: repo, encoding: "utf8" });

const ork = (
  args: readonly string[],
  env: Record<string, string> = {},
  cwd: string = repo,
) =>
  spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      PATH: process.env["PATH"] ?? "",
      HOME: repo,
      ORK_NO_UPDATE_CHECK: "1",
      ...env,
    },
  });

/** A command that counts its runs in `runs.log` (ignored, so not in the files). */
const counting = (code = 0): string[] => [
  "--",
  process.execPath,
  "-e",
  `require("fs").appendFileSync("runs.log","x");process.exit(${String(code)})`,
];

const runs = (): number =>
  readFileSync(path.join(repo, "runs.log"), "utf8").length;

beforeEach(() => {
  repo = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-once-cli-")));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  writeFileSync(path.join(repo, ".gitignore"), "runs.log\n");
  writeFileSync(path.join(repo, "a.txt"), "one\n");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  writeFileSync(path.join(repo, "runs.log"), "");
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("ork once", () => {
  it("skips a check that passed on the same files, with one line", () => {
    expect(ork(["once", ...counting()]).status).toBe(0);
    const again = ork(["once", ...counting()]);
    expect(again.status).toBe(0);
    expect(again.stdout).toMatch(HIT);
    expect(runs()).toBe(1);
  });

  it("runs again after an edit or a new file", () => {
    ork(["once", ...counting()]);
    appendFileSync(path.join(repo, "a.txt"), "two\n");
    expect(ork(["once", ...counting()]).stdout).toBe("");
    writeFileSync(path.join(repo, "b.txt"), "new\n");
    ork(["once", ...counting()]);
    expect(runs()).toBe(3);
  });

  it("runs again with --force or ORK_ONCE=off", () => {
    ork(["once", ...counting()]);
    ork(["once", "--force", ...counting()]);
    ork(["once", ...counting()], { ORK_ONCE: "off" });
    expect(runs()).toBe(3);
  });

  it("takes the command's own flags as the command's", () => {
    const result = ork(["once", "--", "echo", "--force", "hi"]);
    expect(result.stdout.trim()).toBe("--force hi");
  });

  it("runs a command whose own flag is --help or -h", () => {
    const help = ork(["once", "--", "echo", "--help"]);
    expect(help.stdout.trim()).toBe("--help");
    expect(ork(["once", "--", "echo", "-h"]).stdout.trim()).toBe("-h");
  });

  it("still shows its own help before --", () => {
    expect(ork(["once", "--help", "--", "echo", "hi"]).stdout).toContain(
      "--with-head",
    );
  });

  it("names the check with --as, and --covers passes for another name", () => {
    ork(["once", "--as", "full", "--covers", "quick", ...counting()]);
    expect(ork(["once", "--as", "quick", ...counting()]).stdout).toMatch(HIT);
    expect(ork(["once", "--as", "other", ...counting()]).stdout).toBe("");
    expect(runs()).toBe(2);
  });

  it("names a check by its command text by default", () => {
    const other = [
      "--",
      process.execPath,
      "-e",
      `require("fs").appendFileSync("runs.log","y")`,
    ];
    ork(["once", ...counting()]);
    expect(ork(["once", ...other]).stdout).toBe("");
    expect(ork(["once", ...counting()]).stdout).toMatch(HIT);
    expect(runs()).toBe(2);
  });

  it("keys by HEAD with --with-head", () => {
    ork(["once", "--as", "q", "--with-head", ...counting()]);
    expect(
      ork(["once", "--as", "q", "--with-head", ...counting()]).stdout,
    ).toMatch(HIT);
    git("commit", "-q", "--allow-empty", "-m", "next");
    ork(["once", "--as", "q", "--with-head", ...counting()]);
    expect(runs()).toBe(2);
  });

  it("returns a failing command's code and records nothing", () => {
    expect(ork(["once", ...counting(3)]).status).toBe(3);
    expect(ork(["once", ...counting(3)]).status).toBe(3);
    expect(runs()).toBe(2);
  });

  it("is shared by the worktrees of one repository", () => {
    const other = path.join(repo, "..", `${path.basename(repo)}-wt`);
    git("worktree", "add", "-q", "--detach", other);
    try {
      ork(["once", ...counting()]);
      const result = ork(["once", ...counting()], {}, other);
      expect(result.stdout).toMatch(HIT);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it("says what is missing when there is no command", () => {
    const none = ork(["once", "--force"]);
    expect(none.status).toBe(1);
    expect(none.stderr).toContain("after --");
    expect(ork(["once", "--"]).status).toBe(1);
  });

  it("is in --help and in completion", () => {
    expect(ork(["--help"]).stdout).toContain("once");
    expect(ork(["once", "--help"]).stdout).toContain("--with-head");
    expect(ork(["__complete", "once", "--"]).stdout).toContain("covers");
  });
});
