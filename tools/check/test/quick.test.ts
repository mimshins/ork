/** @file Tests for the file list `pnpm check:quick` hands to the linters. */

import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { changedFiles } from "../quick.ts";

const roots: string[] = [];

const git = (cwd: string, ...args: string[]): void => {
  execFileSync("git", args, { cwd, stdio: "ignore" });
};

/** A repository with `a.ts`, `old.ts`, `gone.ts` and `.gitignore` committed. */
const repo = (): string => {
  const cwd = mkdtempSync(path.join(tmpdir(), "ork-quick-"));
  roots.push(cwd);
  git(cwd, "init", "-q");
  git(cwd, "config", "user.email", "t@example.com");
  git(cwd, "config", "user.name", "t");
  git(cwd, "config", "commit.gpgsign", "false");
  writeFileSync(path.join(cwd, ".gitignore"), "ignored.ts\n");
  for (const f of ["a.ts", "gone.ts"]) {
    writeFileSync(path.join(cwd, f), `export const x = "${f}";\n`);
  }
  writeFileSync(path.join(cwd, "old.ts"), "export const old = 1;\n".repeat(20));
  git(cwd, "add", "-A");
  git(cwd, "commit", "-qm", "init");
  return cwd;
};

afterEach(() => {
  for (const cwd of roots.splice(0)) rmSync(cwd, { recursive: true });
});

describe("changedFiles", () => {
  it("is empty on a clean tree", () => {
    expect(changedFiles(repo())).toEqual([]);
  });

  it("lists an edited file and an untracked one, not an ignored one", () => {
    const cwd = repo();
    writeFileSync(path.join(cwd, "a.ts"), "export const x = 2;\n");
    mkdirSync(path.join(cwd, "docs"));
    writeFileSync(path.join(cwd, "docs/new.md"), "# new\n");
    writeFileSync(path.join(cwd, "ignored.ts"), "export {};\n");
    expect(changedFiles(cwd).toSorted()).toEqual(["a.ts", "docs/new.md"]);
  });

  it("leaves out a deleted file", () => {
    const cwd = repo();
    unlinkSync(path.join(cwd, "gone.ts"));
    expect(changedFiles(cwd)).toEqual([]);
  });

  it("lists a staged rename once, by its new name", () => {
    const cwd = repo();
    git(cwd, "mv", "old.ts", "renamed.ts");
    expect(changedFiles(cwd)).toEqual(["renamed.ts"]);
  });

  it("lists a file both staged and edited once", () => {
    const cwd = repo();
    writeFileSync(path.join(cwd, "a.ts"), "export const x = 2;\n");
    git(cwd, "add", "a.ts");
    writeFileSync(path.join(cwd, "a.ts"), "export const x = 3;\n");
    expect(changedFiles(cwd)).toEqual(["a.ts"]);
  });

  it("keeps a name with a space whole", () => {
    const cwd = repo();
    writeFileSync(path.join(cwd, "my file.ts"), "export {};\n");
    expect(changedFiles(cwd)).toEqual(["my file.ts"]);
  });
});
