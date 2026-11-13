/**
 * @file Tests `kit.ts commit`: one commit in a throwaway repo, and each refusal
 *   (no kit root, a git folder outside it, outside the temp folder, and this
 *   project's checkout and worktrees).
 */

import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { commitAll } from "../commit.ts";
import { kitGit, ROOT_MARKER } from "../setup.ts";

const PROJECT = path.resolve(import.meta.dirname, "../../..");

const made: string[] = [];
const worktrees: string[] = [];

afterEach(() => {
  for (const tree of worktrees.splice(0)) {
    spawnSync("git", ["worktree", "remove", "--force", tree], { cwd: PROJECT });
  }
  spawnSync("git", ["worktree", "prune"], { cwd: PROJECT });
  for (const dir of made.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A fresh folder under the temp folder, with or without the kit marker. */
const folder = (marked: boolean): string => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-qa-commit-")));
  made.push(dir);
  writeFileSync(path.join(dir, marked ? ROOT_MARKER : "other"), "");
  return dir;
};

/** A repo with one commit and an uncommitted file, in `parent/repos/name`. */
const repoIn = (parent: string, name = "r"): string => {
  const repo = path.join(parent, "repos", name);
  mkdirSync(repo, { recursive: true });
  writeFileSync(path.join(repo, "a.txt"), "a\n");
  kitGit(repo, ["init", "--quiet", "-b", "main"]);
  kitGit(repo, ["add", "-A"]);
  kitGit(repo, ["commit", "--quiet", "-m", "first"]);
  writeFileSync(path.join(repo, "b.txt"), "b\n");
  return repo;
};

describe("commitAll", () => {
  it("commits everything in a repo inside a kit root, as the kit's identity", () => {
    const repo = repoIn(folder(true));
    expect(commitAll(repo, "second")).toContain("Committed");
    expect(kitGit(repo, ["log", "-1", "--format=%an <%ae> %s"]).trim()).toBe(
      "ork-qa <qa@invalid> second",
    );
    expect(kitGit(repo, ["status", "--porcelain"])).toBe("");
  });

  it("refuses a repo with no kit root above it", () => {
    const repo = repoIn(folder(false));
    expect(() => commitAll(repo)).toThrow("not inside a QA kit root");
  });

  it("refuses a linked worktree whose git folder is outside any kit root", () => {
    const outside = repoIn(folder(false));
    kitGit(outside, ["add", "-A"]);
    kitGit(outside, ["commit", "--quiet", "-m", "second"]);
    const tree = path.join(folder(true), "repos", "linked");
    kitGit(outside, ["worktree", "add", "--quiet", "--detach", tree]);
    expect(() => commitAll(tree)).toThrow("not inside a QA kit root");
  });

  it("refuses a folder outside the temp folder, this project's checkout", () => {
    expect(() => commitAll(PROJECT)).toThrow("not inside the temp folder");
  });

  it("refuses a repo of this project's git folder inside a kit root", () => {
    const outside = repoIn(folder(false));
    kitGit(outside, ["add", "-A"]);
    kitGit(outside, ["commit", "--quiet", "-m", "second"]);
    const tree = path.join(folder(true), "repos", "linked");
    kitGit(outside, ["worktree", "add", "--quiet", "--detach", tree]);
    const common = realpathSync(path.join(outside, ".git"));
    expect(() => commitAll(tree, "x", common)).toThrow(
      "belongs to this project",
    );
  });

  it("refuses a worktree of this project placed inside a kit root", () => {
    const tree = path.join(folder(true), "repos", "project");
    worktrees.push(tree);
    kitGit(PROJECT, ["worktree", "add", "--quiet", "--detach", tree]);
    writeFileSync(path.join(tree, "stray.txt"), "x\n");
    expect(() => commitAll(tree)).toThrow("belongs to this project");
  });
});
