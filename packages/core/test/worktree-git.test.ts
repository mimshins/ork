/**
 * @file Tests that Ork's `git` runs the commands for one folder one at a time:
 *   two children handed their owner's work at once both stage it, and run
 *   together the second `git add -A` failed on the index's lock (run 0427fb01's
 *   engine node).
 */

import { describe, expect, it } from "vitest";

import { gitOk } from "../src/worktree/git.ts";
import { repo, write } from "./fixtures/git.ts";

/** A repo with many changed files, so staging it takes a moment. */
const busyRepo = (): string => {
  const root = repo();
  for (let file = 0; file < 300; file += 1) {
    write(
      root,
      `src/gen/file-${String(file)}.ts`,
      `export const n = ${String(file)};\n`,
    );
  }
  return root;
};

describe("git in one folder", () => {
  it("stages the same worktree from many callers at once without a lock error", async () => {
    const root = busyRepo();
    const staged = await Promise.allSettled(
      Array.from({ length: 12 }, () => gitOk(root, ["add", "-A"])),
    );
    expect(staged.filter(result => result.status === "rejected")).toEqual([]);
  });

  it("keeps each caller's order in the folder", async () => {
    const root = busyRepo();
    const [, tree] = await Promise.all([
      gitOk(root, ["add", "-A"]),
      gitOk(root, ["write-tree"]),
    ]);
    const listed = await gitOk(root, [
      "ls-tree",
      "-r",
      "--name-only",
      tree.trim(),
    ]);
    expect(listed).toContain("src/gen/file-299.ts");
  });
});
