/**
 * @file Tests for checks run once (`ork once`): the key is the working tree's
 *   files, a pass is kept in the common git folder for every worktree, only a
 *   pass on identical files skips a check, and passes are pruned.
 */

import { mkdtempSync, readdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  findPass,
  onceDirOf,
  prunePasses,
  recordPass,
  runOnce,
  type RunOnceOptions,
  treeKeyOf,
} from "../src/index.ts";
import { repo, sh, write } from "./fixtures/git.ts";

/** A check that counts its runs and exits with `code`. */
const counting = (code = 0) => {
  const check = {
    runs: 0,
    run: () => {
      check.runs += 1;
      return Promise.resolve(code);
    },
  };
  return check;
};

const once = (
  cwd: string,
  check: { run: () => Promise<number> },
  options: Partial<RunOnceOptions> = {},
) => runOnce({ cwd, name: "check", env: {}, run: check.run, ...options });

describe("the tree key", () => {
  it("is the same for the same files and leaves the real index alone", async () => {
    const root = repo();
    write(root, "src/new.ts", "export const n = 1;\n");
    const first = await treeKeyOf(root);
    expect(await treeKeyOf(root)).toEqual(first);
    expect(sh(root, "status", "--porcelain")).toContain("?? src/new.ts");
    expect(first.commonDir).toBe(path.join(root, ".git"));
  });

  it("ignores ignored files and counts untracked ones", async () => {
    const root = repo();
    const before = await treeKeyOf(root);
    write(root, "secret.txt", "changed, but ignored\n");
    expect((await treeKeyOf(root)).tree).toBe(before.tree);
    write(root, "notes.md", "untracked\n");
    expect((await treeKeyOf(root)).tree).not.toBe(before.tree);
  });

  it("keeps the tree through a commit, with a new HEAD", async () => {
    const root = repo();
    write(root, "src/app.ts", "export const app = 1;\n");
    const before = await treeKeyOf(root);
    sh(root, "commit", "-qam", "edit");
    const after = await treeKeyOf(root);
    expect(after.tree).toBe(before.tree);
    expect(after.head).not.toBe(before.head);
  });
});

describe("runOnce", () => {
  it("skips a check that passed on the same files", async () => {
    const root = repo();
    const check = counting();
    const first = await once(root, check, { who: "r1/build" });
    const second = await once(root, check);
    expect(first).toMatchObject({ skipped: false, code: 0 });
    expect(second).toMatchObject({
      skipped: true,
      code: 0,
      pass: { name: "check", who: "r1/build" },
    });
    expect(check.runs).toBe(1);
  });

  it("runs again after an edit, a new untracked file, or another Node", async () => {
    const root = repo();
    const check = counting();
    await once(root, check);
    write(root, "src/app.ts", "export const edited = 1;\n");
    await once(root, check);
    write(root, "src/other.ts", "export {};\n");
    await once(root, check);
    await once(root, check, { node: "v99.0.0" });
    expect(check.runs).toBe(4);
  });

  it("runs again with force or ORK_ONCE=off", async () => {
    const root = repo();
    const check = counting();
    await once(root, check);
    const forced = await once(root, check, { force: true });
    const off = await once(root, check, { env: { ORK_ONCE: "off" } });
    expect(forced.skipped).toBe(false);
    expect(off.skipped).toBe(false);
    expect(check.runs).toBe(3);
  });

  it("records nothing for a failing check", async () => {
    const root = repo();
    const failing = await once(root, counting(1));
    expect(failing).toEqual({ skipped: false, code: 1 });
    expect(findPass({ key: await treeKeyOf(root), name: "check" })).toBe(null);
  });

  it("records nothing when the files change while the check runs", async () => {
    const root = repo();
    const result = await once(root, {
      run: () => {
        write(root, "src/app.ts", "export const late = 1;\n");
        return Promise.resolve(0);
      },
    });
    expect(result.pass).toBeUndefined();
    expect(findPass({ key: await treeKeyOf(root), name: "check" })).toBe(null);
  });

  it("makes a covered name a hit on the same files and HEAD", async () => {
    const root = repo();
    await once(root, counting(), { covers: ["check:changed"] });
    const changed = counting();
    const hit = await once(root, changed, {
      name: "check:changed",
      withHead: true,
    });
    sh(root, "commit", "-q", "--allow-empty", "-m", "moved");
    await once(root, changed, { name: "check:changed", withHead: true });
    expect(hit.skipped).toBe(true);
    expect(changed.runs).toBe(1);
  });

  it("shares passes between worktrees of one repository", async () => {
    const root = repo();
    const other = path.join(path.dirname(root), "other");
    sh(root, "worktree", "add", "-q", "--detach", other);
    const check = counting();
    await once(root, check, { who: "you" });
    const there = await once(other, check);
    expect(there.skipped).toBe(true);
    expect(check.runs).toBe(1);
  });

  it("always runs outside a git repository", async () => {
    const folder = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-once-")));
    const check = counting();
    await once(folder, check);
    await once(folder, check);
    expect(check.runs).toBe(2);
  });
});

describe("prunePasses", () => {
  it("removes passes past their age and past the newest entries", async () => {
    const root = repo();
    const key = await treeKeyOf(root);
    const day = 24 * 60 * 60 * 1000;
    const now = new Date("2026-11-11T12:00:00Z");
    const at = (days: number) => new Date(now.getTime() - days * day);
    recordPass({ key, name: "old", who: "you", at: at(8) });
    recordPass({ key, name: "a", who: "you", at: at(3) });
    recordPass({ key, name: "b", who: "you", at: at(2) });
    recordPass({ key, name: "c", who: "you", at: at(1) });
    const removed = prunePasses(key.commonDir, { now, maxEntries: 2 });
    expect(removed).toBe(2);
    expect(readdirSync(onceDirOf(key.commonDir))).toHaveLength(2);
    expect(findPass({ key, name: "c" })).not.toBe(null);
    expect(findPass({ key, name: "a" })).toBe(null);
  });
});
