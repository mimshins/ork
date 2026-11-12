/**
 * @file Tests that Ork commits what a node left in its worktree, except while a
 *   rebase is underway there: a conflict resolver's edits stay unstaged and
 *   uncommitted for the step that finishes the rebase.
 */

import { describe, expect, it } from "vitest";

import { commitLeftovers } from "../src/index.ts";
import { repo, sh, write } from "./fixtures/git.ts";

/** A linked worktree stopped on a rebase conflict in `a.txt`, then edited. */
const midRebase = (): string => {
  const root = repo();
  const tree = `${root}-wt`;
  sh(root, "checkout", "-q", "-b", "base");
  write(root, "a.txt", "base\n");
  sh(root, "add", "-A");
  sh(root, "commit", "-q", "-m", "base");
  sh(root, "worktree", "add", "-q", "-b", "side", tree, "base");
  write(root, "a.txt", "main side\n");
  sh(root, "commit", "-q", "-am", "main side");
  write(tree, "a.txt", "other side\n");
  sh(tree, "commit", "-q", "-am", "other side");
  try {
    sh(tree, "rebase", "base");
  } catch {
    // The conflict this test wants.
  }
  write(tree, "a.txt", "resolved\n");
  return tree;
};

describe("commitLeftovers", () => {
  it("leaves a worktree mid-rebase exactly as it is", async () => {
    const tree = midRebase();
    const before = sh(tree, "status", "--porcelain");
    expect(await commitLeftovers(tree, "ork: resolve")).toBe(false);
    expect(sh(tree, "status", "--porcelain")).toBe(before);
    expect(sh(tree, "log", "-1", "--format=%s", "HEAD")).toBe("main side\n");
  });

  it("still commits a worktree with nothing underway", async () => {
    const root = repo();
    write(root, "b.txt", "new\n");
    expect(await commitLeftovers(root, "ork: node")).toBe(true);
    expect(sh(root, "log", "-1", "--format=%s")).toBe("ork: node\n");
  });
});
