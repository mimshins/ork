/**
 * @file Tests that keeping `ork:onboard-write`'s change in an attached project
 *   carries a change to `project.yaml` too (RFC-022 option D, ADR-114): a
 *   writer that adds the rules file, and one that changes the file Ork's folder
 *   already holds, both end with `<folder>/project.yaml` as written and the
 *   repository untouched.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { settleWrite } from "../src/onboard/runs.ts";
import { setUp, WRITE_INPUTS } from "./fixtures/attached-onboard.ts";
import { SCRIPT, WORKFLOW_FILE, WRITTEN } from "./fixtures/onboard.ts";
import { git } from "./fixtures/run-root-kit.ts";

const RULES = ".ork/project.yaml";
const SEEDED = "schemaVersion: 1\nheavy:\n  - pnpm check\n";
const WRITTEN_RULES = "schemaVersion: 1\nheavy:\n  - pnpm test\n";

/** A project whose writer leaves a workflow and `project.yaml` (as written). */
const writing = () =>
  setUp({
    script: {
      ...SCRIPT,
      rounds: [{ [WORKFLOW_FILE]: WRITTEN, [RULES]: WRITTEN_RULES }],
    },
  });

type Setup = ReturnType<typeof writing>;

/** Runs the writer seeded from the folder (with `seeded` as its rules, if any). */
const kept = async (s: Setup, seeded?: string) => {
  mkdirSync(path.join(s.place.dir, "workflows"), { recursive: true });
  if (seeded !== undefined) {
    writeFileSync(path.join(s.place.dir, "project.yaml"), seeded);
  }
  const done = await s.run("ork:onboard-write", WRITE_INPUTS, {
    seed: s.place.dir,
  });
  if (done.result === null) throw new Error("the run did not start");
  return settleWrite(
    {
      store: s.store,
      place: s.place,
      driver: "open-code",
      runtime: () => Promise.reject(new Error("unused")),
      out: () => {},
      err: () => {},
    },
    done.result,
    [],
    false,
  );
};

const rulesIn = (s: Setup): string =>
  readFileSync(path.join(s.place.dir, "project.yaml"), "utf8");

describe("keep with a project.yaml change in an attached project", () => {
  it("adds the rules file beside the workflow", async () => {
    const s = writing();
    const { lines, code } = await kept(s);
    expect(s.errors).toEqual([]);
    expect(code).toBe(0);
    expect(lines[0]).toBe(
      `kept the workflows in ${s.place.dir}: project.yaml, workflows/check-on-change.ork.yaml`,
    );
    expect(rulesIn(s)).toBe(WRITTEN_RULES);
    expect(git(s.root, "status", "--porcelain")).toBe(s.before.status);
  });

  it("changes the rules file the folder already holds", async () => {
    const s = writing();
    const { lines, code } = await kept(s, SEEDED);
    expect(code).toBe(0);
    expect(lines[0]).toContain("project.yaml");
    expect(rulesIn(s)).toBe(WRITTEN_RULES);
    expect(git(s.root, "status", "--porcelain")).toBe(s.before.status);
  });
});
