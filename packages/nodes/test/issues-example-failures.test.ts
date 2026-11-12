/**
 * @file Runs the `issues` example's failure paths for real, with the fake `gh`
 *   and sessions of `issues-world.ts`. Each way a run can fail before its pull
 *   request takes `in-progress` off every listed issue (the `unmark` node) and
 *   still ends `failed`. `gather` says why it left an issue out: its builder
 *   failed, or passed and left no branch.
 */

import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  failEdit,
  failPrCreate,
  type Script,
  ghLog,
  git,
  ONE,
  open,
  outputOf,
  run,
  stderrOf,
  TWO,
  world,
} from "./issues-world.ts";

/** Runs the workflow over issues 1 and 2, named by number. */
const runTwo = async (
  script: Script,
  prepare: (w: ReturnType<typeof world>) => void = () => {},
) => {
  const w = world();
  open(w, 1, 2);
  prepare(w);
  const ended = await run(w, script, { issues: "1,2" });
  return { w, ...ended };
};

/**
 * Fails the test unless the run took `in-progress` off both issues and ended
 * `failed`.
 */
const expectUnmarked = (
  w: ReturnType<typeof world>,
  ended: Awaited<ReturnType<typeof runTwo>>,
) => {
  expect(ended.result.status).toBe("failed");
  expect(ended.ran).toContain("unmark");
  const log = ghLog(w);
  for (const number of [1, 2]) {
    expect(log).toContain(
      `issue edit ${String(number)} --remove-label in-progress`,
    );
  }
  expect(stderrOf(ended.events, "unmark")).toBe(
    "The run stopped before its pull request; took in-progress off #1, #2.\n",
  );
};

describe("a run that fails before its pull request takes its labels off", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("when `mark` fails for one issue", async () => {
    const ended = await runTwo({ builds: { 1: ONE, 2: TWO } }, w => {
      failEdit(w, 1);
    });
    expectUnmarked(ended.w, ended);
    expect(ended.ran).not.toContain("gather");
  });

  it("when every builder fails", async () => {
    const ended = await runTwo({ builds: { 1: "fail", 2: "fail" } });
    expectUnmarked(ended.w, ended);
    expect(ended.ran).not.toContain("gather");
  });

  it("when every builder passes with no branch, so `gather` exits 1", async () => {
    const ended = await runTwo({ builds: { 1: "no-branch", 2: "no-branch" } });
    expectUnmarked(ended.w, ended);
    expect(ended.ran).toContain("gather");
    expect(ended.ran).not.toContain("review.1");
    expect(stderrOf(ended.events, "gather")).toContain(
      "#1 its builder left no branch",
    );
  });

  it("when every review asks for changes", async () => {
    const ended = await runTwo({
      builds: { 1: ONE, 2: TWO },
      rejected: [1, 2],
    });
    expectUnmarked(ended.w, ended);
    expect(ended.ran).not.toContain("prepare");
  });

  it("when `prepare` fails", async () => {
    const ended = await runTwo({
      builds: { 1: ONE, 2: TWO },
      prepareFails: true,
    });
    expectUnmarked(ended.w, ended);
    expect(ended.ran).not.toContain("plan");
  });

  it("when every integration is dropped", async () => {
    const ended = await runTwo({ builds: { 1: ONE, 2: TWO } }, w => {
      // The fetch of the base fails, so `integrate` fails with no conflict.
      git(
        w.project,
        "remote",
        "set-url",
        "origin",
        path.join(w.base, "gone.git"),
      );
    });
    expectUnmarked(ended.w, ended);
    expect(ended.ran).toContain("drop");
    expect(ended.ran).not.toContain("push");
  });

  it("when `gh pr create` fails", async () => {
    const ended = await runTwo({ builds: { 1: ONE, 2: TWO } }, w => {
      failPrCreate(w);
    });
    expectUnmarked(ended.w, ended);
    expect(ended.ran).toContain("pr");
  });
});

describe("`gather` says why it left an issue out", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("names a failed builder, and a builder that passed and left no branch", async () => {
    const w = world();
    open(w, 1, 2, 3);
    const { result } = await run(
      w,
      { builds: { 1: ONE, 2: "fail", 3: "no-branch" } },
      { issues: "1,2,3" },
    );
    expect(result.status).toBe("succeeded");
    const left = outputOf(result, "leftOut");
    expect(left).toContain("#2: its builder failed: could not build it");
    expect(left).toContain(
      "#3: its builder left no branch (a run with --in-place makes none)",
    );
  });
});
