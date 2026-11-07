/**
 * @file Tests for git's local variables: the fixed list holds every one the
 *   installed git names (skipped without git), and core's git runner acts on
 *   the repository at its `cwd` though a hook's `GIT_DIR` and `GIT_INDEX_FILE`
 *   point at another one.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearGitLocalEnv,
  GIT_LOCAL_ENV,
  withoutGitLocalEnv,
} from "../src/index.ts";
import { git } from "../src/worktree/git.ts";
import { repo, sh, write } from "./fixtures/git.ts";

/** What the installed git names, or `null` without git. */
const installedLocalEnv = (): string[] | null => {
  const result = spawnSync("git", ["rev-parse", "--local-env-vars"], {
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.split("\n").filter(Boolean) : null;
};

const installed = installedLocalEnv();
/** What the installed git names; empty (and the test skipped) without git. */
const named = installed ?? [];

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("git's local variables", () => {
  it.skipIf(installed === null)(
    "include every one the installed git names",
    () => {
      expect(GIT_LOCAL_ENV).toEqual(expect.arrayContaining(named));
    },
  );

  it("are left out of a copy, and cleared in place", () => {
    const env = { GIT_DIR: "/x/.git", GIT_INDEX_FILE: "/x/index", HOME: "/h" };
    expect(withoutGitLocalEnv(env)).toEqual({ HOME: "/h" });
    expect(env.GIT_DIR).toBe("/x/.git");
    clearGitLocalEnv(env);
    expect(env).toEqual({ HOME: "/h" });
  });
});

describe("core's git runner under a hook's variables", () => {
  it("acts on the repository at its cwd, not the one GIT_DIR names", async () => {
    const ours = repo();
    const hooks = repo();
    vi.stubEnv("GIT_DIR", path.join(hooks, ".git"));
    vi.stubEnv("GIT_INDEX_FILE", path.join(hooks, ".git", "index"));
    vi.stubEnv("GIT_WORK_TREE", hooks);
    write(ours, "new.txt", "ours\n");
    const top = await git(ours, ["rev-parse", "--show-toplevel"]);
    expect(top.stdout.trim()).toBe(ours);
    expect((await git(ours, ["add", "new.txt"])).code).toBe(0);
    vi.unstubAllEnvs();
    expect(sh(ours, "diff", "--cached", "--name-only").trim()).toBe("new.txt");
    expect(sh(hooks, "diff", "--cached", "--name-only").trim()).toBe("");
    expect(existsSync(path.join(hooks, "new.txt"))).toBe(false);
  });
});
