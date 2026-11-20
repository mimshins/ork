/**
 * @file Tests for a run's checks before it starts, with its own root: a run
 *   root was handed its commit, so a remote `git.base` is not fetched again
 *   (one that can't be reached stops a run without a root).
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { inRepoPlace, openStore } from "@krapht/ork-core";
import { createCliRuntime } from "@krapht/ork-runtime";
import { parseWorkflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import { preflight } from "../src/run/preflight.ts";
import { openCodeReady, standInDrivers } from "./fixtures/drivers.ts";
import { projectWith, unreachableOrigin } from "./fixtures/git-origin.ts";

const FAKE_CLAUDE = path.resolve(
  import.meta.dirname,
  "../../runtime/test/fixtures/fake-claude.mjs",
);

const TEXT = [
  "schemaVersion: 1",
  "name: build",
  "rules: { git: { base: origin/main } }",
  "nodes:",
  "  build: { type: agent.worker, prompt: Go }",
  "",
].join("\n");

const parsedOf = (text: string) => {
  const parsed = parseWorkflow(text);
  if (!parsed.ok) throw new Error("the workflow does not parse");
  return parsed.workflow;
};

/** `preflight` of TEXT in `dir`, with or without a run root. */
const checkIn = (dir: string, runRoot: boolean) => {
  const workflow = parsedOf(TEXT);
  return preflight(
    {
      file: "build.ork.yaml",
      cwd: dir,
      inputs: [],
      inPlace: false,
      json: false,
      runtime: () => Promise.resolve(createCliRuntime({ bin: FAKE_CLAUDE })),
      driverChecks: openCodeReady,
      drivers: standInDrivers,
      store: openStore(":memory:"),
      home: mkdtempSync(path.join(tmpdir(), "ork-home-")),
      out: () => {},
      err: () => {},
      installed: () => true,
    },
    {
      workflow,
      effective: workflow,
      place: inRepoPlace(dir),
      projects: [],
      inputs: {},
      runRoot,
    },
  );
};

describe("a run with its own root", () => {
  it("fetches no git.base: it was handed its commit", async () => {
    const dir = projectWith(TEXT, true, "build.ork.yaml");
    unreachableOrigin(dir);
    expect(await checkIn(dir, true)).toMatchObject({ ok: true });
    expect(await checkIn(dir, false)).toMatchObject({
      ok: false,
      lines: [expect.stringMatching(/^git fetch origin main failed/u)],
    });
  });
});
