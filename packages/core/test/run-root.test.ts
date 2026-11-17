/**
 * @file Tests for a run's own working root (RFC-021 Option C): opened beside
 *   the clone from a resolved base commit, on a branch or detached by the git
 *   rules; closed with force although it holds untracked files, idempotently
 *   and with its folder already gone, keeping a branch that has a commit of its
 *   own; re-created at a recorded commit after HEAD moved, or adopted when
 *   left; refused on a link, a stranger's folder, a bad base and no repository;
 *   and findable by its run through its `created` event when detached.
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  DEFAULT_BRANCH_TEMPLATE,
  DEFAULT_WORKTREES_TEMPLATE,
  type ResolvedGitRules,
} from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import {
  createWorktree,
  listOrkWorktrees,
  openRunRoot,
  RUN_ROOT_ID,
  runRootEvent,
  worktreePath,
} from "../src/index.ts";
import { repo, sh, write } from "./fixtures/git.ts";

const rules = (commit: "auto" | "never" = "auto"): ResolvedGitRules => ({
  commit,
  merge: commit === "never" ? "patch" : "auto",
  base: "HEAD",
  branch: DEFAULT_BRANCH_TEMPLATE,
  worktrees: DEFAULT_WORKTREES_TEMPLATE,
});

const head = (cwd: string): string => sh(cwd, "rev-parse", "HEAD").trim();

const branches = (root: string): string =>
  sh(root, "branch", "--list", "ork/*");

const commitIn = (cwd: string, file: string): void => {
  write(cwd, file, `${file}\n`);
  sh(cwd, "add", "-A");
  sh(cwd, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", file);
};

const open = (root: string, commit?: "auto" | "never", base = "HEAD") =>
  openRunRoot({ root, runId: "r1", rules: rules(commit), base });

describe("openRunRoot", () => {
  it("opens beside the clone on ork/<run>/audit-root at the resolved HEAD", async () => {
    const root = repo();
    const opened = await open(root);
    expect(opened).toMatchObject({
      path: worktreePath(root, "r1", RUN_ROOT_ID),
      branch: "ork/r1/audit-root",
      base: head(root),
      source: root,
      adopted: false,
    });
    expect(head(opened.path)).toBe(head(root));
  });

  it("is detached under commit: never", async () => {
    const root = repo();
    const opened = await open(root, "never");
    expect(opened.branch).toBeUndefined();
    expect(sh(opened.path, "branch", "--show-current").trim()).toBe("");
  });

  it("closes with force, untracked files and branch included", async () => {
    const root = repo();
    const opened = await open(root);
    write(opened.path, ".ork/runs/.builtin/abc/prompt.md", "untracked\n");
    await opened.close();
    expect(existsSync(opened.path)).toBe(false);
    expect(sh(root, "worktree", "list")).not.toContain(opened.path);
    expect(branches(root)).toBe("");
  });

  it("closes twice, and with its folder already gone, without an error", async () => {
    const root = repo();
    const opened = await open(root);
    rmSync(opened.path, { recursive: true, force: true });
    await opened.close();
    await expect(opened.close()).resolves.toBeUndefined();
    expect(sh(root, "worktree", "list")).not.toContain(opened.path);
  });

  it("keeps a branch that has a commit of its own", async () => {
    const root = repo();
    const opened = await open(root);
    commitIn(opened.path, "made-in-the-run.txt");
    await opened.close();
    expect(branches(root)).toContain("ork/r1/audit-root");
  });

  it("re-creates at the recorded commit after HEAD moved", async () => {
    const root = repo();
    const first = await open(root, "never");
    await first.close();
    commitIn(root, "later.txt");
    const again = await open(root, "never", first.base);
    expect(again.base).toBe(first.base);
    expect(head(again.path)).toBe(first.base);
    expect(head(root)).not.toBe(first.base);
  });

  it("adopts the folder a stopped run left", async () => {
    const root = repo();
    const first = await open(root);
    const again = await openRunRoot({
      root,
      runId: "r1",
      rules: rules(),
      base: first.base,
      known: true,
    });
    expect(again).toMatchObject({ path: first.path, adopted: true });
  });

  it("refuses a link at the worktree path and creates nothing", async () => {
    const root = repo();
    const at = worktreePath(root, "r1", RUN_ROOT_ID);
    const elsewhere = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-rr-")));
    mkdirSync(path.dirname(at), { recursive: true });
    symlinkSync(elsewhere, at);
    await expect(open(root)).rejects.toThrow(/is a link/u);
    expect(lstatSync(at).isSymbolicLink()).toBe(true);
    expect(branches(root)).toBe("");
  });

  it("refuses a folder that is not one of the repository's worktrees", async () => {
    const root = repo();
    mkdirSync(worktreePath(root, "r1", RUN_ROOT_ID), { recursive: true });
    await expect(open(root)).rejects.toThrow(/is not a worktree of/u);
  });

  it("refuses a base that is no commit", async () => {
    await expect(open(repo(), "auto", "no-such-ref")).rejects.toThrow(
      /no-such-ref is not a commit/u,
    );
  });

  it("refuses a folder that is no git repository", async () => {
    const plain = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-rr-")));
    await expect(open(plain)).rejects.toThrow(/is not a git repository/u);
  });
});

/**
 * The checkout's ignored local files (fixture: `.worktreeinclude` and agent
 * files).
 */
const LOCAL = [".claude/settings.local.json", ".env", "CLAUDE.local.md"];

/** Which of the local files are in `folder`. */
const localIn = (folder: string): string[] =>
  LOCAL.filter(file => existsSync(path.join(folder, file)));

describe("ignored local files", () => {
  it("are copied into a node's worktree, and not with copyLocal: false", async () => {
    const root = repo();
    const base = head(root);
    const copied = await createWorktree({
      root,
      path: worktreePath(root, "r1", "lead"),
      base,
    });
    const bare = await createWorktree({
      root,
      path: worktreePath(root, "r1", "bare"),
      base,
      copyLocal: false,
    });
    expect([copied.copied.toSorted(), localIn(copied.path)]).toEqual([
      LOCAL,
      LOCAL,
    ]);
    expect([bare.copied, localIn(bare.path)]).toEqual([[], []]);
  });

  it("are never in a run root", async () => {
    const root = repo();
    expect(localIn(root)).toEqual(LOCAL);
    expect(localIn((await open(root)).path)).toEqual([]);
  });
});

describe("runRootEvent", () => {
  it("records a detached leftover so the worktree list finds it by its run", async () => {
    const root = repo();
    const opened = await open(root, "never");
    const event = runRootEvent(opened, "created");
    expect(event).toEqual({
      type: "worktree",
      id: RUN_ROOT_ID,
      action: "created",
      path: opened.path,
    });
    const listed = await listOrkWorktrees(root, [
      { runId: "r1", nodeId: event.id, path: event.path },
    ]);
    expect(listed).toMatchObject([
      { runId: "r1", nodeId: RUN_ROOT_ID, path: opened.path, recorded: true },
    ]);
  });
});
