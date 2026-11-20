/**
 * @file Tests for the model check in `ork run`'s preflight (RFC-026 option 6C):
 *   a node that names an exact `omp` model its list lacks is refused before a
 *   session starts; fuzzy, templated and other-driver models, a failed list and
 *   `ork validate` cost no check; the list is read once per run.
 */

import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { type EventStore, openStore } from "@krapht/ork-core";
import { parseWorkflow, type Workflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import { runWorkflowFile } from "../src/index.ts";
import { type ModelList, modelRefusals } from "../src/run/model-check.ts";
import { readyOnly, standInDrivers } from "./fixtures/drivers.ts";

const READY = { ready: "claude-code" } as const;

const FAKE = ["fake/fake-model", "other/model"];

const node = (id: string, extra: string): string =>
  `  ${id}:\n    type: agent.worker\n    isolation: shared\n    prompt: go\n${extra}`;

const yamlOf = (...nodes: string[]): string =>
  `schemaVersion: 1\nname: notes\nnodes:\n${nodes.join("")}`;

const workflowOf = (yaml: string): Workflow => {
  const parsed = parseWorkflow(yaml);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return parsed.workflow;
};

/** A list that answers `selectors` and counts its calls per driver. */
const listing = (selectors: readonly string[] | null) => {
  const asked: string[] = [];
  const list: ModelList = driver => {
    asked.push(driver);
    return Promise.resolve(selectors);
  };
  return { list, asked };
};

const refusals = async (
  yaml: string,
  selectors: readonly string[] | null = FAKE,
  choice: Parameters<typeof modelRefusals>[1] = READY,
) => {
  const { list, asked } = listing(selectors);
  const lines = await modelRefusals(workflowOf(yaml), choice, list);
  return { lines, asked };
};

describe("modelRefusals", () => {
  it("refuses an exact model the list lacks, naming node, model and the command", async () => {
    const { lines } = await refusals(
      yamlOf(node("build", "    model: omp.fake/nope\n")),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("node `build`");
    expect(lines[0]).toContain("`fake/nope`");
    expect(lines[0]).toContain("`omp models`");
  });

  it("refuses the same through `driver: omp` and a plain model", async () => {
    const { lines } = await refusals(
      yamlOf(node("build", "    driver: omp\n    model: fake/nope\n")),
    );
    expect(lines).toHaveLength(1);
  });

  it("refuses through --driver or the run's ready driver", async () => {
    const yaml = yamlOf(node("build", "    model: fake/nope\n"));
    expect(
      (await refusals(yaml, FAKE, { override: "omp" })).lines,
    ).toHaveLength(1);
    expect((await refusals(yaml, FAKE, { ready: "omp" })).lines).toHaveLength(
      1,
    );
  });

  it("passes a model the list has, case-sensitively", async () => {
    const ok = yamlOf(node("build", "    model: omp.fake/fake-model\n"));
    expect((await refusals(ok)).lines).toEqual([]);
    const cased = yamlOf(node("build", "    model: omp.fake/Fake-Model\n"));
    expect((await refusals(cased)).lines).toHaveLength(1);
  });

  it("asks nothing for a fuzzy, templated or other-driver model", async () => {
    const yaml = yamlOf(
      node("fuzzy", "    model: omp.sonnet\n"),
      node("templated", "    model: omp.{{ inputs.m }}/x\n"),
      node("claude", "    model: claude-code.opus\n"),
      node("plain", "    driver: claude-code\n    model: fake/nope\n"),
      node("none", ""),
    );
    const found = await refusals(yaml);
    expect(found.lines).toEqual([]);
    expect(found.asked).toEqual([]);
  });

  it("says nothing when the list fails or is empty", async () => {
    const yaml = yamlOf(node("build", "    model: omp.fake/nope\n"));
    expect((await refusals(yaml, null)).lines).toEqual([]);
    expect((await refusals(yaml, [])).lines).toEqual([]);
  });

  it("reads the list once for many nodes", async () => {
    const found = await refusals(
      yamlOf(
        node("a", "    model: omp.fake/nope\n"),
        node("b", "    model: omp.fake/fake-model\n"),
        node("c", "    model: omp.other/missing\n"),
      ),
    );
    expect(found.lines).toHaveLength(2);
    expect(found.asked).toEqual(["omp"]);
  });
});

const start = (yaml: string, list: ModelList) => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-models-")));
  writeFileSync(path.join(dir, "notes.ork.yaml"), yaml);
  const store: EventStore = openStore(":memory:");
  const err: string[] = [];
  const started: string[] = [];
  return runWorkflowFile({
    file: "notes.ork.yaml",
    cwd: dir,
    inputs: [],
    inPlace: true,
    json: false,
    runtime: driver => {
      started.push(driver);
      return Promise.reject(new Error("no session may start"));
    },
    driverChecks: readyOnly("claude-code"),
    drivers: standInDrivers,
    modelList: list,
    human: {
      ask: () => Promise.resolve("none"),
      permit: () => Promise.resolve({ allow: false, message: "no" }),
    },
    store,
    home: mkdtempSync(path.join(tmpdir(), "ork-home-")),
    out: () => {
      // The transcript isn't what these check.
    },
    err: line => {
      err.push(line);
    },
  }).then(done => ({ ...done, err, started }));
};

describe("ork run's model check", () => {
  it("refuses before any session starts", async () => {
    const { list } = listing(FAKE);
    const done = await start(
      yamlOf(node("build", "    model: omp.fake/nope\n")),
      list,
    );
    expect(done.exitCode).toBe(1);
    expect(done.started).toEqual([]);
    expect(done.err.join("\n")).toContain("`omp models`");
  });

  it("lets an exact model the list has past the preflight", async () => {
    const { list, asked } = listing(FAKE);
    const done = await start(
      yamlOf(node("build", "    model: omp.fake/fake-model\n")),
      list,
    );
    // `omp` is unproven, so the node itself stops: the run began, so the
    // preflight (and its one model list) passed.
    expect(JSON.stringify(done)).not.toContain("omp models");
    expect(done.result).toBeDefined();
    expect(asked).toEqual(["omp"]);
  });
});
