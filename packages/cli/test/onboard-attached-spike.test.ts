/**
 * @file Spike for `ork onboard` in attached projects (RFC-022 option D): runs
 *   the real `ork:onboard-propose` and `ork:onboard-write` bundles in a
 *   registered (attached) project with a scripted runtime, and shows what the
 *   engine does today. Each opens an ADR-100 run root; the bundle's `context:`
 *   files reach the sessions; `write`'s worktree is cut from the run root's
 *   commit (a copy of HEAD), beside the clone; `finish` and the other tool
 *   nodes work in the run root; and `keepRun` and `discardRun` find the
 *   writer's worktree by the run's id in the same repository once the run root
 *   is gone.
 */

import { existsSync, readdirSync, writeFileSync } from "node:fs";

import { placeFiles } from "@krapht/ork-core";
import { describe, expect, it } from "vitest";

import { commitsAhead, discardRun, keepRun } from "../src/runs/keep.ts";
import {
  outputOf,
  setUp,
  text,
  WRITE_INPUTS,
} from "./fixtures/attached-onboard.ts";
import { WORKFLOW_FILE } from "./fixtures/onboard.ts";
import {
  checkoutNow,
  git,
  onlyRun,
  rootActions,
  rootOf,
  worktreesOf,
} from "./fixtures/run-root-kit.ts";

describe("ork:onboard-propose in an attached project", () => {
  it("opens a run root, resolves its context, and leaves the checkout alone", async () => {
    const s = setUp();
    const done = await s.run("ork:onboard-propose", [
      "survey=a one-file app",
      "answers=Q: slow tests\nA: weekly",
    ]);
    expect(s.errors).toEqual([]);
    expect(done.result?.status).toBe("succeeded");
    const id = onlyRun(s.store).id;
    expect(rootActions(s.store, id)).toEqual(["created", "removed"]);
    const [propose] = s.specs;
    expect(propose?.cwd).toBe(rootOf(s.root, id));
    expect(propose?.systemAppend).toContain(
      "Proposing workflows: the rule for `ork:onboard-propose`",
    );
    expect(checkoutNow(s.root)).toEqual(s.before);
  });
});

describe("ork:onboard-write in an attached project", () => {
  it("cuts write's worktree from the run root's commit; tools run in the run root; keepRun finds it", async () => {
    const s = setUp();
    const head = git(s.root, "rev-parse", "HEAD").trim();
    const done = await s.run("ork:onboard-write", WRITE_INPUTS);
    expect(s.errors).toEqual([]);
    expect(done.result?.status).toBe("succeeded");
    const id = onlyRun(s.store).id;
    const runRoot = rootOf(s.root, id);

    // (a) the run root opened and closed; the bundle's context reached write.
    expect(rootActions(s.store, id)).toEqual(["created", "removed"]);
    const write = s.specs.find(spec => spec.nodeId === "write");
    expect(write?.systemAppend).toContain(
      "Writing workflows: the rule for `ork:onboard-write`",
    );

    // (b) write's worktree: beside the clone, from HEAD, on its own branch.
    const out = outputOf(done.result, "write");
    const worktree = text(out["worktree"]);
    const branch = text(out["branch"]);
    expect(write?.cwd).toBe(worktree);
    expect(branch).toBe(`ork/${id}/write`);
    // Named from the run root's folder, as any node's is from its root.
    expect(worktree).toBe(`${runRoot}-worktrees/ork-${id}-write`);
    expect(git(s.root, "merge-base", head, branch).trim()).toBe(head);
    expect(worktreesOf(s.root)).toEqual([s.root, worktree]);

    // (c) format, finish and changes all ran in the run root.
    expect(s.cwds).toHaveLength(3);
    expect(new Set(s.cwds)).toEqual(new Set([runRoot]));
    expect(text(outputOf(done.result, "finish")["stdout"])).toBe(
      "problems:\n- none\nneeds your eye:\n- none\n",
    );
    expect(git(s.root, "show", "--name-only", "--format=", branch)).toContain(
      WORKFLOW_FILE,
    );

    // (d) keepRun finds the worktree by the run id in the same repository.
    expect(await commitsAhead(s.store, s.root, id)).toBeGreaterThan(0);
    expect(await keepRun(s.store, s.root, id, { branch, worktree })).toEqual({
      kept: "branch",
    });
    expect(await discardRun(s.store, s.root, id)).toContain(
      `removed ${worktree}`,
    );
    expect(existsSync(worktree)).toBe(false);
    expect(readdirSync(`${runRoot}-worktrees`)).toEqual([]);
    expect(worktreesOf(s.root)).toEqual([s.root]);
  });

  it("under commit: never, write is detached and keepRun applies its change", async () => {
    const s = setUp();
    writeFileSync(
      placeFiles(s.place).rules,
      "schemaVersion: 1\ngit: { commit: never }\n",
    );
    const done = await s.run("ork:onboard-write", WRITE_INPUTS);
    expect(s.errors).toEqual([]);
    expect(done.result?.status).toBe("succeeded");
    const id = onlyRun(s.store).id;
    const out = outputOf(done.result, "write");
    const worktree = text(out["worktree"]);
    expect(out["branch"]).toBeUndefined();
    expect(git(s.root, "branch", "--list", "ork/*")).toBe("");
    const kept = await keepRun(s.store, s.root, id, { branch: "", worktree });
    // This run is not seeded (no `seed` option), so it lands in the checkout;
    // a seeded run applies to Ork's folder (onboard-attached-keep.test.ts).
    expect(kept).toEqual({
      kept: "applied",
      files: [WORKFLOW_FILE],
      removed: [`removed ${worktree}`],
    });
    expect(existsSync(`${s.root}/${WORKFLOW_FILE}`)).toBe(true);
  });
});
