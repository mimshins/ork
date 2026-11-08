/**
 * @file Tests that a node's worktree removed outside Ork (run 0427fb01's leader
 *   ran `git worktree remove` on its child's) is noticed when the node runs
 *   again: git forgets it, so it opens anew rather than failing with "spawn git
 *   ENOENT"; and that git in a missing folder says so.
 */

import { rmSync } from "node:fs";
import path from "node:path";

import type { ResolvedGitRules } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import { gitOk } from "../src/worktree/git.ts";
import { reenter } from "../src/worktree/handoff.ts";
import { createWorktree } from "../src/worktree/manager.ts";
import { repo, sh } from "./fixtures/git.ts";

const NEVER: ResolvedGitRules = {
  commit: "never",
  merge: "patch",
  base: "main",
  branch: "",
  worktrees: "",
};

/** A repo and a detached worktree beside it, as `commit: never` makes. */
const withWorktree = async () => {
  const root = repo();
  const target = path.join(path.dirname(root), "child");
  const worktree = await createWorktree({ root, path: target, base: "HEAD" });
  return { root, worktree };
};

describe("a worktree removed outside Ork", () => {
  it("is still there when nothing removed it", async () => {
    const { root, worktree } = await withWorktree();
    expect(await reenter(root, NEVER, worktree, undefined, false)).toBe("same");
  });

  it("is noticed, forgotten by git, and can be opened again", async () => {
    const { root, worktree } = await withWorktree();
    rmSync(worktree.path, { recursive: true, force: true });
    expect(await reenter(root, NEVER, worktree, undefined, false)).toBe("gone");
    expect(sh(root, "worktree", "list")).not.toContain(worktree.path);
    const again = await createWorktree({
      root,
      path: worktree.path,
      base: "HEAD",
    });
    expect(again.path).toBe(worktree.path);
  });

  it("makes git in a missing folder say which folder", async () => {
    const { root, worktree } = await withWorktree();
    rmSync(worktree.path, { recursive: true, force: true });
    await expect(gitOk(worktree.path, ["status"])).rejects.toThrow(
      `the folder ${worktree.path} doesn't exist`,
    );
    expect(root).not.toBe(worktree.path);
  });
});
