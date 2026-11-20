/**
 * @file End-to-end tests of `ork onboard` in an attached project (RFC-022
 *   option D, ADR-114): the whole command, to the gate and a keep, leaves the
 *   repository as it was and puts the canonical workflow in Ork's folder, where
 *   it validates under the project's rules; a failed run and a run that changed
 *   nothing leave the folder as it was; the seed commit runs no commit hook;
 *   and whatever the project's `git` rules, the run makes no branch.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { openStore } from "@krapht/ork-core";
import { describe, expect, it } from "vitest";

import { loadWorkflow } from "../src/commands/validate.ts";
import { registerProject } from "../src/index.ts";
import {
  branchesOf,
  outputOf,
  settled,
  setUp,
  text,
  WRITE_INPUTS,
} from "./fixtures/attached-onboard.ts";
import {
  canonical,
  onboard,
  repository,
  SCRIPT,
  UNCAPPED,
  WORKFLOW_FILE,
  WRITTEN,
} from "./fixtures/onboard.ts";
import { git, registered, tmp, worktreesOf } from "./fixtures/run-root-kit.ts";

type Setup = ReturnType<typeof setUp>;

const EXISTING = canonical(WRITTEN.replace("check-on-change", "existing"));

/** Ork's folder for the project with one workflow of its own; returns it. */
const withWorkflow = (dir: string): string => {
  mkdirSync(path.join(dir, "workflows"), { recursive: true });
  writeFileSync(path.join(dir, "workflows/existing.ork.yaml"), EXISTING);
  return dir;
};

/** The folder's workflows and rules as text, to compare before and after. */
const folderNow = (dir: string): string =>
  JSON.stringify(
    [
      "workflows/existing.ork.yaml",
      "workflows/check-on-change.ork.yaml",
      "project.yaml",
    ].map(file =>
      existsSync(path.join(dir, file))
        ? readFileSync(path.join(dir, file), "utf8")
        : null,
    ),
  );

/** A seeded write run of `s`, answered `keep`; its result. */
const seededWrite = async (s: Setup) => {
  withWorkflow(s.place.dir);
  const done = await s.run("ork:onboard-write", WRITE_INPUTS, {
    seed: s.place.dir,
  });
  if (done.result === null) throw new Error("the run did not start");
  return done.result;
};

describe("ork onboard in an attached project", () => {
  it("reaches the gate, keeps into Ork's folder, and leaves the repository alone", async () => {
    const root = repository();
    const store = openStore(":memory:");
    const home = tmp("ork-home-");
    const place = registered(registerProject(store, root, { home }));
    withWorkflow(place.dir);
    const status = git(root, "status", "--porcelain");
    const branches = branchesOf(root);
    const flow = await onboard({
      driver: "open-code",
      script: SCRIPT,
      root,
      store,
      inProcess: ["format", "finish"],
    });
    expect(flow.err).not.toContain("error");
    expect(flow.code).toBe(0);
    expect(flow.gate).toHaveLength(1);
    expect(flow.out).toContain(
      `kept the workflows in ${place.dir}: workflows/check-on-change.ork.yaml`,
    );
    expect(git(root, "status", "--porcelain")).toBe(status);
    expect(branchesOf(root)).toBe(branches);
    expect(existsSync(path.join(root, ".ork"))).toBe(false);
    expect(worktreesOf(root)).toEqual([root]);

    const kept = path.join(place.dir, "workflows/check-on-change.ork.yaml");
    expect(readFileSync(kept, "utf8")).toBe(canonical(WRITTEN));
    const errors = loadWorkflow(
      kept,
      root,
      home,
      store.projects(),
    ).report.diagnostics.filter(d => d.severity === "error");
    expect(errors).toEqual([]);
  });
});

describe("a seeded write run that keeps nothing", () => {
  it("leaves the folder as it was when the run fails, and its worktree for a resume", async () => {
    const s = setUp({
      script: { ...SCRIPT, rounds: [{ [WORKFLOW_FILE]: UNCAPPED }] },
    });
    withWorkflow(s.place.dir);
    const before = folderNow(s.place.dir);
    const result = await seededWrite(s);
    expect(result.status).toBe("failed");
    const { code } = await settled(s, result);
    expect(code).toBe(1);
    expect(folderNow(s.place.dir)).toBe(before);
    expect(worktreesOf(s.root)).toEqual([
      s.root,
      text(outputOf(result, "write")["worktree"]),
    ]);
    expect(branchesOf(s.root)).toBe(s.branchesAtStart);
  });

  it("leaves the folder as it was, and no worktree, when the writer changed nothing", async () => {
    const s = setUp({ script: { ...SCRIPT, rounds: [{}] } });
    withWorkflow(s.place.dir);
    const before = folderNow(s.place.dir);
    const { lines, code } = await settled(s, await seededWrite(s));
    expect(code).toBe(0);
    expect(lines[0]).toBe(
      "the writer changed nothing, so there's nothing to keep",
    );
    expect(folderNow(s.place.dir)).toBe(before);
    expect(worktreesOf(s.root)).toEqual([s.root]);
  });
});

describe("the seed commit", () => {
  it("runs no commit hook of the repository", async () => {
    const s = setUp();
    const marker = path.join(tmp("ork-hook-"), "ran");
    const hook = path.join(s.root, ".git/hooks/pre-commit");
    writeFileSync(hook, `#!/bin/sh\ntouch "${marker}"\nexit 1\n`, {
      mode: 0o755,
    });
    const result = await seededWrite(s);
    const seed = text(outputOf(result, "write")["seed"]);
    expect(git(s.root, "show", "--name-only", "--format=", seed)).toContain(
      ".ork/workflows/existing.ork.yaml",
    );
    expect((await settled(s, result)).code).toBe(0);
    expect(existsSync(marker)).toBe(false);
  });
});

describe("the writer's worktree under the project's git rules", () => {
  it.each([
    ["commit: auto", "git:\n  commit: auto\n"],
    ["a branch rule", "git:\n  branch: work/{run}/{node}\n"],
    ["commit: never", "git:\n  commit: never\n"],
  ])("is detached under %s, and no branch is made", async (_name, rules) => {
    const s = setUp();
    writeFileSync(
      path.join(s.place.dir, "project.yaml"),
      `schemaVersion: 1\n${rules}`,
    );
    const result = await seededWrite(s);
    expect(s.errors).toEqual([]);
    expect(result.status).toBe("succeeded");
    expect(outputOf(result, "write")["branch"]).toBeUndefined();
    expect(s.branches).toEqual(s.branches.map(() => s.branchesAtStart));
    expect(branchesOf(s.root)).toBe(s.branchesAtStart);
    expect((await settled(s, result)).code).toBe(0);
    expect(branchesOf(s.root)).toBe(s.branchesAtStart);
  });
});
