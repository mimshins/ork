/**
 * @file End-to-end tests, with fake claude, for a run's budget reached inside a
 *   session: the run ends `budget_exhausted` in tokens and in dollars, a stop
 *   by the node's own lower cap still fails it, and a node still queued at the
 *   stop counts as skipped in the run summary.
 */

import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { openStore } from "@krapht/ork-core";
import { createCliRuntime } from "@krapht/ork-runtime";
import { describe, expect, it } from "vitest";

import { runWorkflowFile } from "../src/index.ts";
import { formatRunResult } from "../src/run/format-result.ts";
import type { Term } from "../src/term/mode.ts";
import { openCodeReady, standInDrivers } from "./fixtures/drivers.ts";

const FAKE_CLAUDE = path.resolve(
  import.meta.dirname,
  "../../runtime/test/fixtures/fake-claude.mjs",
);

const plainTerm: Term = { rich: false, width: 80, rows: 24 };

const quiet = (): void => {};

/** An agent node's line, with `extra` keys after its prompt. */
const agent = (id: string, extra = "") =>
  `  ${id}: { type: agent.worker, isolation: shared, prompt: Write${extra} }\n`;

/** Runs `nodes` under `limits`, with fake claude playing `scenario`. */
const runCapped = async (limits: string, scenario: string, nodes: string) => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-run-cap-")));
  const home = mkdtempSync(path.join(tmpdir(), "ork-home-"));
  writeFileSync(
    path.join(dir, "cap.ork.yaml"),
    `schemaVersion: 1\nname: cap\nlimits: { ${limits} }\nnodes:\n${nodes}`,
  );
  const env = { ...process.env, FAKE_SCENARIO: scenario };
  const finished = await runWorkflowFile({
    file: "cap.ork.yaml",
    cwd: dir,
    inputs: [],
    inPlace: true,
    json: false,
    runtime: () => Promise.resolve(createCliRuntime({ bin: FAKE_CLAUDE, env })),
    driverChecks: openCodeReady,
    drivers: standInDrivers,
    store: openStore(":memory:"),
    home,
    out: quiet,
    err: quiet,
    installed: () => true,
  });
  if (finished.result === null) throw new Error("the run did not start");
  return finished.result;
};

describe("a run's budget reached inside a session", () => {
  it("ends the run budget_exhausted in tokens", async () => {
    // Fake claude's `spend` counts 125 tokens a step: the second reaches 200.
    const result = await runCapped(
      "budgetTokens: 200",
      "spend",
      agent("write"),
    );
    expect(result).toMatchObject({
      status: "budget_exhausted",
      reasons: ["the run's budget of 200 tokens is spent"],
    });
  });

  it("ends the run budget_exhausted in dollars", async () => {
    const result = await runCapped(
      "budgetUsd: 0.5",
      "end:budget_limit",
      agent("write"),
    );
    expect(result).toMatchObject({
      status: "budget_exhausted",
      reasons: ["the run's budget of $0.5 is spent"],
    });
  });

  it("still fails a node its own, lower cap stopped", async () => {
    const result = await runCapped(
      "budgetTokens: 1000",
      "spend",
      agent("write", ", budgetTokens: 200"),
    );
    expect(result.status).toBe("failed");
  });

  it("counts a node still queued at the stop as skipped in the summary", async () => {
    // One slot: `second` waits in the queue while `first` spends the budget.
    const result = await runCapped(
      "budgetTokens: 200, concurrency: 1",
      "spend",
      agent("first") + agent("second"),
    );
    expect(result).toMatchObject({ status: "budget_exhausted", skipped: 1 });
    expect(formatRunResult(result, plainTerm)[1]).toContain(
      "· 1 ran, 1 skipped",
    );
  });
});
