/**
 * @file Tests of a seeded run (RFC-022 option D, ADR-114): `ork:onboard-write`
 *   run with `seed` set to an attached project's Ork folder, whose rules let
 *   Ork commit. The run makes no commit on any branch: no `ork/*` branch exists
 *   at any session, and the writer's worktree is detached, on the seed commit
 *   that holds the folder's workflows and rules under `.ork/`, with its change
 *   uncommitted; the output carries `seed` and the run records the folder for a
 *   resume. Also the seed's paths and prefix, and the rules a seed forces.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Workflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import { seedFor, withoutCommits } from "../src/run/run-root.ts";
import {
  outputOf,
  settingsOf,
  setUp,
  text,
  WRITE_INPUTS,
} from "./fixtures/attached-onboard.ts";
import { WORKFLOW_FILE } from "./fixtures/onboard.ts";
import { clone, git, onlyRun, tmp } from "./fixtures/run-root-kit.ts";

const EXISTING = "workflows/existing.ork.yaml";

/** An Ork folder with an existing workflow, the rules, and what isn't seeded. */
const orkFolder = (folder: string): string => {
  mkdirSync(path.join(folder, "workflows/nested"), { recursive: true });
  writeFileSync(path.join(folder, EXISTING), "name: existing\n");
  writeFileSync(path.join(folder, "workflows/notes.md"), "not a workflow\n");
  writeFileSync(path.join(folder, "project.yaml"), "schemaVersion: 1\n");
  return folder;
};

describe("a seeded run of ork:onboard-write in an attached project", () => {
  it("makes no branch, and the writer works detached on the seed commit", async () => {
    const s = setUp();
    const folder = orkFolder(s.place.dir);
    const head = git(s.root, "rev-parse", "HEAD").trim();
    const done = await s.run("ork:onboard-write", WRITE_INPUTS, {
      seed: folder,
    });
    expect(s.errors).toEqual([]);
    expect(done.result?.status).toBe("succeeded");

    const out = outputOf(done.result, "write");
    const worktree = text(out["worktree"]);
    const seed = text(out["seed"]);
    expect(out["branch"]).toBeUndefined();
    expect(git(worktree, "rev-parse", "HEAD").trim()).toBe(seed);
    expect(git(worktree, "rev-parse", `${seed}~1`).trim()).toBe(head);
    expect(git(worktree, "show", "--name-only", "--format=", seed)).toBe(
      ".ork/project.yaml\n.ork/workflows/existing.ork.yaml\n",
    );
    expect(git(worktree, "status", "--porcelain")).toContain(WORKFLOW_FILE);

    expect(s.branches).toEqual(s.branches.map(() => s.branchesAtStart));
    expect(s.branches.length).toBeGreaterThan(0);
    expect(git(s.root, "branch", "--list", "ork/*")).toBe("");
    expect(settingsOf(s.store, onlyRun(s.store).id).seed).toBe(folder);
  });

  it("seeds nothing from an empty folder and still works detached", async () => {
    const s = setUp();
    const head = git(s.root, "rev-parse", "HEAD").trim();
    const done = await s.run("ork:onboard-write", WRITE_INPUTS, {
      seed: tmp("ork-empty-"),
    });
    expect(done.result?.status).toBe("succeeded");
    const out = outputOf(done.result, "write");
    expect(out["seed"]).toBe(head);
    expect(out["branch"]).toBeUndefined();
    expect(git(s.root, "branch", "--list", "ork/*")).toBe("");
  });
});

describe("a run's seed", () => {
  it("names the folder's workflows one level deep and its rules", () => {
    const root = clone(false);
    const folder = orkFolder(tmp("ork-seed-"));
    expect(seedFor(folder, root)).toEqual({
      seed: { from: folder, to: ".ork", paths: [EXISTING, "project.yaml"] },
    });
  });

  it("goes under a subfolder project's prefix, and names nothing of a missing folder", () => {
    const root = clone(false);
    mkdirSync(path.join(root, "app"));
    const folder = path.join(tmp("ork-seed-"), "gone");
    expect(seedFor(folder, path.join(root, "app"))).toEqual({
      seed: { from: folder, to: "app/.ork", paths: [] },
    });
    expect(seedFor(undefined, root)).toEqual({});
  });

  it("forces commit: never, with a merge that needs no commits", () => {
    const workflow: Workflow = {
      schemaVersion: 1,
      name: "w",
      nodes: {},
      rules: { git: { merge: "auto", base: "main" } },
    };
    expect(withoutCommits(workflow).rules?.git).toEqual({
      commit: "never",
      merge: "patch",
      base: "main",
    });
  });
});
