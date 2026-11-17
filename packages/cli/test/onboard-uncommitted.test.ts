/**
 * @file Tests for the uncommitted files `ork onboard` tells the writer its
 *   worktree lacks: what git reports under `.ork/` and `.gitignore`, and how
 *   that merges with what `ork init` made.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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
