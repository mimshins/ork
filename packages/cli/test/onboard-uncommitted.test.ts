/**
 * @file Tests for the uncommitted files `ork onboard` tells the writer its
 *   worktree lacks: what git reports under `.ork/` and `.gitignore`, and how
 *   that merges with what `ork init` made.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  initNote,
  uncommittedFiles,
  withUncommitted,
} from "../src/onboard/setup.ts";

const gitIn = (cwd: string, ...args: string[]): void => {
  execFileSync(
    "git",
    [
      "-c",
      "user.name=T",
      "-c",
      "user.email=t@example.com",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd, stdio: "ignore" },
  );
};

const put = (root: string, file: string, text: string): void => {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
};

/** A repo whose one commit holds `.ork/project.yaml`, with `.ork/runs/` ignored. */
const committed = (): string => {
  const root = mkdtempSync(path.join(tmpdir(), "ork-uncommitted-"));
  put(root, ".ork/project.yaml", "a: 1\n");
  put(root, ".gitignore", ".ork/runs/\n");
  gitIn(root, "init", "--quiet");
  gitIn(root, "add", "-A");
  gitIn(root, "commit", "--quiet", "-m", "base");
  return root;
};

describe("uncommittedFiles", () => {
  it("is empty when nothing under .ork/ or .gitignore is uncommitted", () => {
    const root = committed();
    put(root, ".ork/runs/r1/log", "ignored\n");
    put(root, "src/app.ts", "outside\n");
    expect(uncommittedFiles(root)).toEqual([]);
    expect(initNote(uncommittedFiles(root))).toBe("");
  });

  it("names modified and untracked files under .ork/ and .gitignore, not ignored ones", () => {
    const root = committed();
    put(root, ".ork/project.yaml", "a: 2\n");
    put(root, ".ork/workflows/build.ork.yaml", "x\n");
    put(root, ".gitignore", ".ork/runs/\nnode_modules/\n");
    put(root, ".ork/runs/r1/log", "ignored\n");
    put(root, "src/app.ts", "outside\n");
    const files = uncommittedFiles(root);
    expect(files.toSorted()).toEqual([
      ".gitignore",
      ".ork/project.yaml",
      ".ork/workflows/build.ork.yaml",
    ]);
    expect(initNote(files)).toContain("uncommitted");
    expect(initNote(files)).not.toContain("just");
  });

  it("names paths relative to a project folder that is a subfolder of its repo", () => {
    const repo = mkdtempSync(path.join(tmpdir(), "ork-uncommitted-sub-"));
    const sub = path.join(repo, "sub");
    put(sub, ".ork/project.yaml", "a: 1\n");
    gitIn(repo, "init", "--quiet");
    gitIn(repo, "add", "-A");
    gitIn(repo, "commit", "--quiet", "-m", "base");
    put(sub, ".ork/project.yaml", "a: 2\n");
    put(sub, ".ork/workflows/x.ork.yaml", "x\n");
    expect(uncommittedFiles(sub).toSorted()).toEqual([
      ".ork/project.yaml",
      ".ork/workflows/x.ork.yaml",
    ]);
    // What `ork init` just made is untracked too, and is named once.
    put(sub, ".ork/workflows/hello.ork.yaml", "h\n");
    expect(
      withUncommitted(
        [".ork/workflows/hello.ork.yaml"],
        uncommittedFiles(sub).toSorted(),
      ),
    ).toEqual([
      ".ork/workflows/hello.ork.yaml",
      ".ork/project.yaml",
      ".ork/workflows/x.ork.yaml",
    ]);
  });

  it("names a staged rename by its new path only", () => {
    const root = committed();
    gitIn(root, "mv", ".ork/project.yaml", ".ork/renamed.yaml");
    expect(uncommittedFiles(root)).toEqual([".ork/renamed.yaml"]);
  });

  it("does not name a tracked file deleted under .ork/, staged or not", () => {
    const root = committed();
    rmSync(path.join(root, ".ork/project.yaml"));
    expect(uncommittedFiles(root)).toEqual([]);
    gitIn(root, "rm", "--quiet", "--cached", ".ork/project.yaml");
    expect(uncommittedFiles(root)).toEqual([]);
  });

  it("is empty, not an error, outside a git repository", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ork-nogit-"));
    put(root, ".ork/project.yaml", "a: 1\n");
    expect(uncommittedFiles(root)).toEqual([]);
  });
});

describe("withUncommitted", () => {
  it("keeps what `ork init` made and adds each reported file once", () => {
    expect(
      withUncommitted(
        [".ork/workflows/hello.ork.yaml", ".gitignore (.ork/runs/)"],
        [".gitignore", ".ork/workflows/hello.ork.yaml", ".ork/project.yaml"],
      ),
    ).toEqual([
      ".ork/workflows/hello.ork.yaml",
      ".gitignore (.ork/runs/)",
      ".ork/project.yaml",
    ]);
  });
});
