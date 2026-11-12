/**
 * @file Tests for the warnings `ork validate` and `ork run` give for a dollar
 *   budget a driver that reports no dollars can't keep (RFC-015): warnings,
 *   never refusals.
 */

import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { type DriverNeeds, type EventStore, openStore } from "@krapht/ork-core";
import { parseWorkflow, type Workflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import { runWorkflowFile } from "../src/index.ts";
import { driverDiagnostics } from "../src/run/driver-check.ts";
import { readyOnly, standInDrivers } from "./fixtures/drivers.ts";

/** Descriptors where `command-code` reports no dollars. */
const unpriced: readonly DriverNeeds[] = standInDrivers.map(d =>
  Object.assign({}, d, {
    capabilities: Object.assign({}, d.capabilities, {
      price: d.id !== "command-code",
    }),
  }),
);

const yamlOf = (extra: string): string =>
  `schemaVersion: 1\nname: notes\n${extra}nodes:\n  build:\n    type: agent.worker\n    isolation: shared\n    driver: command-code\n    prompt: go\n`;

const workflowOf = (yaml: string): Workflow => {
  const parsed = parseWorkflow(yaml);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return parsed.workflow;
};

const check = (extra: string, nodeExtra = "") =>
  driverDiagnostics(
    workflowOf(
      yamlOf(extra).replace("prompt: go\n", `prompt: go\n${nodeExtra}`),
    ),
    { drivers: unpriced, checks: readyOnly("claude-code") },
  );

describe("ork validate's budget warnings", () => {
  it("warns, not refuses, for budgetUsd alone on a driver with no dollars", async () => {
    const found = await check("", "    budgetUsd: 2\n");
    expect(found).toMatchObject([
      { severity: "warning", code: "driver.budget", path: ["nodes", "build"] },
    ]);
    expect(found[0]?.message).toContain("only budgetTokens applies");
  });

  it("is quiet when budgetTokens sits beside it", async () => {
    expect(
      await check("", "    budgetUsd: 2\n    budgetTokens: 5000\n"),
    ).toEqual([]);
  });

  it("warns that a run's dollar limit can't see the node's sessions", async () => {
    const found = await check("limits:\n  budgetUsd: 10\n");
    expect(found).toMatchObject([
      { severity: "warning", code: "driver.budget" },
    ]);
    expect(found[0]?.message).toContain("limits.budgetUsd");
  });
});

describe("ork run's budget warnings", () => {
  it("prints the warning and still starts the session", async () => {
    const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-budget-")));
    writeFileSync(
      path.join(dir, "notes.ork.yaml"),
      yamlOf("limits:\n  budgetUsd: 10\n"),
    );
    const store: EventStore = openStore(":memory:");
    const err: string[] = [];
    const started: string[] = [];
    await runWorkflowFile({
      file: "notes.ork.yaml",
      cwd: dir,
      inputs: [],
      inPlace: true,
      json: false,
      drivers: unpriced,
      runtime: driver => {
        started.push(driver);
        return Promise.reject(new Error("stand-in"));
      },
      driverChecks: readyOnly("claude-code"),
      human: {
        ask: () => Promise.resolve("none"),
        permit: () => Promise.resolve({ allow: false, message: "no" }),
      },
      store,
      home: mkdtempSync(path.join(tmpdir(), "ork-home-")),
      out: () => {
        // The transcript isn't what this checks.
      },
      err: line => {
        err.push(line);
      },
    });
    expect(started).toEqual(["command-code"]);
    expect(err.join("\n")).toContain("limits.budgetUsd");
    expect(err.join("\n")).toContain("warning");
  });
});
