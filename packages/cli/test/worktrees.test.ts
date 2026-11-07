/**
 * @file Tests for `ork worktrees remove` and the live-run rule, for real, in a
 *   temp repository with its own `~`: removing one worktree that loses work
 *   shows what's lost and needs `--force`; a branch with no worktree is
 *   deleted; and neither clean nor remove touches a worktree whose run is still
 *   going.
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

import { openStore, storePath } from "@krapht/ork-core";
import { describe, expect, it } from "vitest";

const BIN = path.resolve(import.meta.dirname, "../src/bin.ts");

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" });

/** A repo with one commit, a worktree on `ork/r1/lead`, and its own `~`. */
const place = () => {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-wt-cli-")));
  const home = path.join(base, "home");
  const root = path.join(base, "app");
  mkdirSync(home);
  mkdirSync(root);
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "dev@example.com");
  git(root, "config", "user.name", "Dev");
  git(root, "config", "commit.gpgsign", "false");
  writeFileSync(path.join(root, "a.ts"), "a\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  const lead = path.join(base, "ork-r1-lead");
  git(root, "worktree", "add", "--quiet", "-b", "ork/r1/lead", lead);
  return { home, root, lead };
};

const ork = (where: ReturnType<typeof place>, ...args: string[]) =>
  spawnSync(process.execPath, [BIN, "worktrees", ...args], {
    cwd: where.root,
    encoding: "utf8",
    env: {
      PATH: process.env["PATH"] ?? "",
      HOME: where.home,
      ORK_NO_UPDATE_CHECK: "1",
    },
  });

describe("ork worktrees remove", () => {
  it("shows what's lost and needs --force to lose it", () => {
    const where = place();
    writeFileSync(path.join(where.lead, "wip.ts"), "wip\n");
    const refused = ork(where, "remove", "ork/r1/lead", "--yes");
    expect(refused.status).toBe(1);
    expect(refused.stdout).toContain("ork/r1/lead: remove worktree");
    expect(refused.stdout).toContain("Uncommitted changes:\n  ?? wip.ts");
    expect(refused.stderr).toContain("pass --force");
    expect(existsSync(where.lead)).toBe(true);
    const forced = ork(where, "remove", where.lead, "--force", "--yes");
    expect(forced.status).toBe(0);
    expect(forced.stdout).toContain(`removed ${where.lead}`);
    expect(existsSync(where.lead)).toBe(false);
  });

  it("deletes a branch with no worktree", () => {
    const where = place();
    git(where.root, "branch", "ork/r2/docs");
    const removed = ork(where, "remove", "ork/r2/docs", "--yes");
    expect(removed.stdout).toContain("deleted ork/r2/docs");
    expect(git(where.root, "branch", "--list", "ork/r2/docs")).toBe("");
  });
});

describe("a run still going", () => {
  it("keeps its worktree from clean --force and from remove", () => {
    const where = place();
    const store = openStore(storePath(where.home));
    // This process stands in for the run's, so the run is alive.
    store.begin({
      id: "r1",
      workflow: "w",
      file: "/w.ork.yaml",
      project: where.root,
    });
    store.close();
    const clean = ork(where, "clean", "--all", "--force", "--yes");
    expect(clean.stdout).toContain(
      "ork/r1/lead: keep (its run is still going)",
    );
    expect(clean.stdout).toContain("Nothing to clean.");
    const remove = ork(where, "remove", "ork/r1/lead", "--force", "--yes");
    expect(remove.stderr).toContain("run r1 is still going; stop it first");
    expect(existsSync(where.lead)).toBe(true);
  });
});
