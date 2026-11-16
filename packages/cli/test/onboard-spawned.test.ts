/**
 * @file Runs the real `ork onboard` as a program with piped stdio (no
 *   terminal), in a git repository with a commit and its own `~`: it refuses,
 *   exit 1, with the one line that says to run it in a terminal, and writes
 *   nothing.
 */

import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

const BIN = path.resolve(import.meta.dirname, "../src/bin.ts");

/** A repository with one commit, and an empty folder to be `~`. */
const project = (): { repo: string; home: string } => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-spawned-")));
  const repo = path.join(root, "repo");
  const home = path.join(root, "home");
  mkdirSync(repo);
  mkdirSync(home);
  writeFileSync(path.join(repo, "README.md"), "# App\n");
  for (const args of [
    ["init", "-q", "-b", "main"],
    ["config", "user.email", "dev@example.com"],
    ["config", "user.name", "Dev"],
    ["add", "-A"],
    ["commit", "-q", "-m", "init"],
  ]) {
    execFileSync("git", args, { cwd: repo });
  }
  return { repo, home };
};

describe("ork onboard without a terminal", () => {
  it("exits 1 saying to run it in a terminal, and writes nothing", () => {
    const { repo, home } = project();
    const run = spawnSync(process.execPath, [BIN, "onboard"], {
      cwd: repo,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        ORK_NO_UPDATE_CHECK: "1",
      },
    });
    expect(run.status).toBe(1);
    expect(`${run.stdout}${run.stderr}`).toContain(
      "ork onboard asks questions: run it in a terminal.",
    );
    expect(existsSync(path.join(repo, ".ork"))).toBe(false);
  });
});
