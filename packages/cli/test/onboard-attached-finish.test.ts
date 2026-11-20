/**
 * @file Tests of a seeded `ork:onboard-write` run in an attached project
 *   (RFC-022 option D, ADR-114), past what the keep tests cover: `finish`
 *   measures from the seed, so an attached workflow's own driver and agents are
 *   not new and an unchanged one is not a change; a file of the folder edited
 *   since the seed refuses the keep; a project in a subfolder of its repository
 *   seeds and keeps under its prefix; the gate's stat lists a new file when
 *   `.ork` is gitignored; and a resumed failed run goes on in its worktree
 *   without seeding it again.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { keepRun } from "../src/runs/keep.ts";
import {
  outputOf,
  settled,
  setUp,
  text,
  WRITE_INPUTS,
} from "./fixtures/attached-onboard.ts";
import {
  canonical,
  SCRIPT,
  UNCAPPED,
  WORKFLOW_FILE,
  WRITTEN,
} from "./fixtures/onboard.ts";
import {
  commit,
  git,
  onlyRun,
  readyToResume,
  worktreesOf,
} from "./fixtures/run-root-kit.ts";

type Setup = ReturnType<typeof setUp>;

const UNTOUCHED = canonical(WRITTEN.replace("check-on-change", "untouched"));
/**
 * An attached workflow with its own driver and agent, which `finish` forbids in
 * new ones.
 */
const CI = canonical(`schemaVersion: 1
name: ci
defaults:
  driver: open-code
agents:
  mine:
    instructions: be me
limits:
  budgetUsd: 2
  budgetTokens: 400000
nodes:
  build:
    type: agent.worker
    agent: mine
    prompt: Build it.
`);
const CI_EDITED = CI.replace("Build it.", "Build it well.");
const CI_FILE = ".ork/workflows/ci.ork.yaml";

/**
 * The writer edits `ci` and adds the pick; the folder holds `ci` and
 * `untouched`.
 */
const editing = () =>
  setUp({
    script: {
      ...SCRIPT,
      rounds: [{ [CI_FILE]: CI_EDITED, [WORKFLOW_FILE]: WRITTEN }],
    },
  });

const put = (dir: string, files: Record<string, string>) => {
  for (const [file, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), body);
  }
};

const read = (dir: string, file: string): string =>
  readFileSync(path.join(dir, file), "utf8");

/** A write run seeded from the project's folder, holding `ci` and `untouched`. */
const seededWrite = async (s: Setup) => {
  put(s.place.dir, {
    "workflows/untouched.ork.yaml": UNTOUCHED,
    "workflows/ci.ork.yaml": CI,
  });
  const done = await s.run("ork:onboard-write", WRITE_INPUTS, {
    seed: s.place.dir,
  });
  if (done.result === null) throw new Error("the run did not start");
  return done.result;
};

describe("finish in a seeded run", () => {
  it("takes the attached workflow's driver and agent as its own, and leaves an unchanged one out", async () => {
    const s = editing();
    const result = await seededWrite(s);
    expect(s.errors).toEqual([]);
    expect(text(outputOf(result, "finish")["stdout"])).toBe(
      "problems:\n- none\nneeds your eye:\n- none\n",
    );
    expect(text(outputOf(result, "changes")["stdout"])).not.toContain(
      "untouched",
    );
    const { lines, code } = await settled(s, result);
    expect(code).toBe(0);
    expect(lines[0]).toBe(
      `kept the workflows in ${s.place.dir}: workflows/check-on-change.ork.yaml, workflows/ci.ork.yaml`,
    );
    expect(read(s.place.dir, "workflows/ci.ork.yaml")).toBe(CI_EDITED);
    expect(read(s.place.dir, "workflows/untouched.ork.yaml")).toBe(UNTOUCHED);
  });

  it("refuses the keep when the folder's copy of an edited file changed since the seed", async () => {
    const s = editing();
    const result = await seededWrite(s);
    const theirs = CI.replace("Build it.", "Build it their way.");
    put(s.place.dir, { "workflows/ci.ork.yaml": theirs });
    const { lines, code } = await settled(s, result);
    const worktree = text(outputOf(result, "write")["worktree"]);
    expect(code).toBe(1);
    expect(lines[0]).toContain(s.place.dir);
    expect(lines[0]).toContain("workflows/ci.ork.yaml");
    expect(lines[1]).toContain(worktree);
    expect(read(s.place.dir, "workflows/ci.ork.yaml")).toBe(theirs);
    expect(
      existsSync(path.join(s.place.dir, "workflows/check-on-change.ork.yaml")),
    ).toBe(false);
    expect(worktreesOf(s.root)).toEqual([s.root, worktree]);
  });
});

describe("a project in a subfolder of its repository", () => {
  // shortcut: `finish` runs at the run root's top, so it refuses the writer's
  // `app/.ork/…` as outside the project, until tool nodes work in the project's
  // folder of the run root; keep is called directly.
  it("seeds and keeps under its prefix, with no worktree inside the repository", async () => {
    const s = setUp({
      sub: "app",
      script: { ...SCRIPT, rounds: [{ [`app/${WORKFLOW_FILE}`]: WRITTEN }] },
    });
    const result = await seededWrite(s);
    expect(s.errors).toEqual([]);
    const out = outputOf(result, "write");
    const seed = text(out["seed"]);
    expect(git(s.root, "show", "--name-only", "--format=", seed)).toBe(
      "app/.ork/workflows/ci.ork.yaml\napp/.ork/workflows/untouched.ork.yaml\n",
    );
    expect(git(s.root, "status", "--porcelain")).toBe(s.before.status);
    const kept = await keepRun(s.store, s.place.root, result.runId, {
      branch: "",
      worktree: text(out["worktree"]),
    });
    expect(kept).toMatchObject({
      kept: "applied",
      into: s.place.dir,
      files: ["workflows/check-on-change.ork.yaml"],
    });
    expect(read(s.place.dir, "workflows/check-on-change.ork.yaml")).toBe(
      WRITTEN,
    );
    expect(git(s.root, "status", "--porcelain")).toBe(s.before.status);
    expect(existsSync(path.join(s.root, "app/.ork"))).toBe(false);
  });
});

describe("the gate's account of the change", () => {
  it("lists a new workflow when .ork is gitignored in the repository", async () => {
    const s = setUp();
    writeFileSync(path.join(s.root, ".gitignore"), ".env\n.ork\n");
    git(s.root, "add", ".gitignore");
    commit(s.root, "ignore .ork");
    const result = await seededWrite(s);
    expect(text(outputOf(result, "changes")["stdout"])).toContain(
      "check-on-change.ork.yaml",
    );
  });
});

describe("a resumed seeded run", () => {
  it("goes on in its worktree, on its seed, and keeps the writer's work", async () => {
    const s = setUp({
      script: {
        ...SCRIPT,
        rounds: [
          ...Array.from({ length: 4 }, () => ({ [WORKFLOW_FILE]: UNCAPPED })),
          { [WORKFLOW_FILE]: WRITTEN },
        ],
      },
    });
    const failed = await seededWrite(s);
    expect(failed.status).toBe("failed");
    const worktree = text(outputOf(failed, "write")["worktree"]);
    const seed = git(worktree, "rev-parse", "HEAD").trim();
    const record = onlyRun(s.store);
    const done = await s.run("ork:onboard-write", [], {
      runId: record.id,
      resume: readyToResume(s.store, record),
    });
    expect(done.result?.status).toBe("succeeded");
    expect(text(outputOf(done.result, "write")["worktree"])).toBe(worktree);
    expect(text(outputOf(done.result, "write")["seed"])).toBe(seed);
    expect(git(worktree, "rev-parse", "HEAD").trim()).toBe(seed);
    expect(read(worktree, WORKFLOW_FILE)).toBe(canonical(WRITTEN));
  });
});
