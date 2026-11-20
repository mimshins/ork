/**
 * @file Tests for what keeping or discarding `ork:onboard-write`'s change does
 *   in an attached project (RFC-022 option D, ADR-114): a seeded run applies
 *   the writer's files to Ork's folder for the project and never to the
 *   repository; a folder that changed since the seed refuses the keep and the
 *   worktree stays; a discard leaves the folder as it was and no worktree
 *   behind.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { settleWrite } from "../src/onboard/runs.ts";
import { setUp, WRITE_INPUTS } from "./fixtures/attached-onboard.ts";
import { WORKFLOW_FILE } from "./fixtures/onboard.ts";
import { commit, git, worktreesOf } from "./fixtures/run-root-kit.ts";

type Setup = ReturnType<typeof setUp>;

const WRITTEN_FILE = path.basename(WORKFLOW_FILE);
const EXISTING = "name: existing\n";

/**
 * The project's workflows (file name to text), to compare the folder
 * before/after; its `runs/` hold the run's own records and are left out.
 */
const listing = (s: Setup): Record<string, string> => {
  const dir = path.join(s.place.dir, "workflows");
  return Object.fromEntries(
    readdirSync(dir).map(name => [
      name,
      readFileSync(path.join(dir, name), "utf8"),
    ]),
  );
};

/**
 * Runs `ork:onboard-write` seeded from the project's folder; `choice` at the
 * gate.
 */
const written = async (s: Setup, choice: "keep" | "discard" = "keep") => {
  mkdirSync(path.join(s.place.dir, "workflows"), { recursive: true });
  writeFileSync(
    path.join(s.place.dir, "workflows/existing.ork.yaml"),
    EXISTING,
  );
  const done = await s.run("ork:onboard-write", WRITE_INPUTS, {
    seed: s.place.dir,
    human: {
      ask: () => Promise.resolve(choice),
      permit: () => Promise.resolve({ allow: true }),
    },
  });
  if (done.result === null) throw new Error("the run did not start");
  return done.result;
};

/** The one worktree besides the checkout. */
const leftWorktree = (s: Setup): string => {
  const [, tree, ...more] = worktreesOf(s.root);
  if (tree === undefined || more.length > 0)
    throw new Error("not one worktree");
  return tree;
};

const settled = (s: Setup, result: Awaited<ReturnType<typeof written>>) =>
  settleWrite(
    {
      store: s.store,
      place: s.place,
      driver: "open-code",
      runtime: () => Promise.reject(new Error("unused")),
      out: () => {},
      err: () => {},
    },
    result,
    [],
    false,
  );

describe("keep in an attached project", () => {
  it("applies the files to Ork's folder and leaves the repository alone", async () => {
    const s = setUp();
    const result = await written(s);
    expect(s.errors).toEqual([]);
    const { lines, code } = await settled(s, result);
    expect(code).toBe(0);
    expect(lines[0]).toBe(
      `kept the workflows in ${s.place.dir}: workflows/${WRITTEN_FILE}`,
    );
    expect(lines[1]).toContain("Nothing is in the repository");
    expect(Object.keys(listing(s)).toSorted()).toEqual([
      WRITTEN_FILE,
      "existing.ork.yaml",
    ]);
    expect(listing(s)[WRITTEN_FILE]).toContain("name: check-on-change");
    expect(listing(s)["existing.ork.yaml"]).toBe(EXISTING);
    expect(git(s.root, "branch", "--list", "ork/*")).toBe("");
    expect(git(s.root, "status", "--porcelain")).toBe(s.before.status);
    expect(existsSync(path.join(s.root, ".ork"))).toBe(false);
    expect(worktreesOf(s.root)).toEqual([s.root]);
  });

  it("keeps a new file when .ork is gitignored in the repository", async () => {
    const s = setUp();
    writeFileSync(path.join(s.root, ".gitignore"), ".env\n.ork\n");
    git(s.root, "add", ".gitignore");
    commit(s.root, "ignore .ork");
    const { lines, code } = await settled(s, await written(s));
    expect(code).toBe(0);
    expect(lines[0]).toContain(`workflows/${WRITTEN_FILE}`);
    expect(existsSync(path.join(s.place.dir, "workflows", WRITTEN_FILE))).toBe(
      true,
    );
  });

  it("refuses when the folder changed since the seed, and keeps the worktree", async () => {
    const s = setUp();
    const result = await written(s);
    const theirs = path.join(s.place.dir, "workflows", WRITTEN_FILE);
    writeFileSync(theirs, "name: added meanwhile\n");
    const before = listing(s);
    const { lines, code } = await settled(s, result);
    expect(code).toBe(1);
    expect(lines[0]).toContain(s.place.dir);
    expect(lines[0]).toContain(`workflows/${WRITTEN_FILE}`);
    const tree = leftWorktree(s);
    expect(lines[1]).toContain(tree);
    expect(listing(s)).toEqual(before);
    expect(existsSync(tree)).toBe(true);
  });

  it("leaves the folder as it was on discard, and no worktree", async () => {
    const s = setUp();
    const result = await written(s, "discard");
    const before = listing(s);
    const { lines, code } = await settled(s, result);
    expect(code).toBe(0);
    expect(lines[0]).toBe("discarded the change; nothing was kept");
    expect(listing(s)).toEqual(before);
    expect(before).toEqual({ "existing.ork.yaml": EXISTING });
    expect(worktreesOf(s.root)).toEqual([s.root]);
    expect(git(s.root, "branch", "--list", "ork/*")).toBe("");
  });
});
