/**
 * @file Tests for the driver refusals in `ork validate` and `ork run`
 *   (RFC-014): a node the driver can't serve, or a driver not yet proven, is
 *   refused in words naming both, before a session starts. The drivers' checks
 *   are fakes; the descriptors are the real ones or fakes with something
 *   missing.
 */

import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { type EventStore, openStore } from "@krapht/ork-core";
import { parseWorkflow, type Workflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import { runWorkflowFile } from "../src/index.ts";
import { driverArg, driverDiagnostics } from "../src/run/driver-check.ts";
import { readyOnly, standInDrivers } from "./fixtures/drivers.ts";

const yamlOf = (extra: string): string =>
  `schemaVersion: 1\nname: notes\nnodes:\n  build:\n    type: claude.worker\n    isolation: shared\n    prompt: go\n${extra}`;

const workflowOf = (yaml: string): Workflow => {
  const parsed = parseWorkflow(yaml);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return parsed.workflow;
};

/** Descriptors where `open-code` is proven but has no turn limit. */
const noTurnLimit = standInDrivers.map(d =>
  Object.assign({}, d, {
    capabilities: Object.assign({}, d.capabilities, {
      turnLimit: d.id !== "open-code",
    }),
  }),
);

/** Descriptors where `open-code` and `command-code` are not yet proven. */
const unproven = standInDrivers.map(d =>
  Object.assign({}, d, { proven: d.id === "claude-code" }),
);

const unasked = () => Promise.reject(new Error("the drivers' checks ran"));

describe("ork validate's driver check", () => {
  it("names the node and the driver for --driver", async () => {
    const found = await driverDiagnostics(
      workflowOf(yamlOf("    maxTurns: 4\n")),
      {
        override: "open-code",
        drivers: noTurnLimit,
        checks: unasked,
      },
    );
    expect(found).toMatchObject([
      {
        severity: "error",
        code: "driver.unfit",
        message:
          "node `build` sets maxTurns, but driver `open-code` has no turn limit",
        path: ["nodes", "build"],
      },
    ]);
  });

  it("checks the driver a run would take when --driver is not given", async () => {
    const workflow = workflowOf(yamlOf("    maxTurns: 4\n"));
    const options = { drivers: noTurnLimit };
    expect(
      await driverDiagnostics(workflow, {
        ...options,
        checks: readyOnly("open-code"),
      }),
    ).toHaveLength(1);
    expect(
      await driverDiagnostics(workflow, {
        ...options,
        checks: readyOnly("claude-code"),
      }),
    ).toEqual([]);
    // Nothing ready: the run says so on its own.
    expect(
      await driverDiagnostics(workflow, { ...options, checks: readyOnly() }),
    ).toEqual([]);
  });

  it("does not look at the machine when every node names its driver", async () => {
    expect(
      await driverDiagnostics(workflowOf(yamlOf("    driver: claude-code\n")), {
        checks: unasked,
      }),
    ).toEqual([]);
  });

  it("refuses a plain node that names no driver when the one ready is unproven", async () => {
    const found = await driverDiagnostics(workflowOf(yamlOf("")), {
      drivers: unproven,
      checks: readyOnly("open-code"),
    });
    expect(found.map(d => d.message)).toEqual([
      "node `build` runs on driver `open-code`, which is not yet proven on a real session",
    ]);
  });

  it("refuses a workflow that names an unproven driver", async () => {
    const found = await driverDiagnostics(
      workflowOf(yamlOf("    driver: command-code\n")),
      { drivers: unproven, checks: unasked },
    );
    expect(found.map(d => d.message)).toEqual([
      "node `build` runs on driver `command-code`, which is not yet proven on a real session",
    ]);
  });

  it("reads --driver, and turns a retired id away with its replacement", () => {
    expect(driverArg().ok).toBe(true);
    expect(driverArg("open-code")).toEqual({ ok: true, driver: "open-code" });
    const retired = driverArg("sdk");
    expect(retired.ok).toBe(false);
    expect(JSON.stringify(retired)).toContain("use `claude-code`");
  });
});

const start = (yaml: string, extra: Record<string, unknown> = {}) => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-refuse-")));
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
    ...extra,
  }).then(done => ({ ...done, err, started }));
};

describe("ork run's driver check", () => {
  it("refuses an unproven driver before any session starts", async () => {
    const done = await start(yamlOf("    driver: command-code\n"), {
      drivers: unproven,
    });
    expect(done.exitCode).toBe(1);
    expect(done.started).toEqual([]);
    expect(done.err.join("\n")).toContain(
      "node `build` runs on driver `command-code`, which is not yet proven on a real session",
    );
  });

  it("refuses a node its driver can't serve, naming both", async () => {
    const done = await start(
      yamlOf("    maxTurns: 4\n    driver: open-code\n"),
      {
        drivers: noTurnLimit,
      },
    );
    expect(done.exitCode).toBe(1);
    expect(done.started).toEqual([]);
    expect(done.err.join("\n")).toContain(
      "node `build` sets maxTurns, but driver `open-code` has no turn limit",
    );
  });
});

const shared = (driver: string) =>
  workflowOf(
    `schemaVersion: 1\nname: notes\nnodes:\n  a:\n    type: claude.worker\n    isolation: shared\n    driver: ${driver}\n    prompt: go\n  b:\n    type: claude.worker\n    isolation: shared\n    driver: ${driver}\n    prompt: go\n`,
  );

const owning = (driver: string) =>
  `schemaVersion: 1\nname: notes\nnodes:\n  lead:\n    type: claude.leader\n    driver: ${driver}\n    prompt: go\n  part:\n    type: claude.worker\n    parent: lead\n    isolation: shared\n    driver: ${driver}\n    prompt: go\n`;

describe("an owner and its child in one checkout on a one-per-checkout driver", () => {
  it("is an error in ork validate, naming the owner and the driver", async () => {
    const found = await driverDiagnostics(workflowOf(owning("command-code")), {
      drivers: standInDrivers,
      checks: unasked,
    });
    expect(found).toMatchObject([
      { severity: "error", code: "driver.unfit", path: ["nodes", "lead"] },
    ]);
    expect(found[0]?.message).toContain(
      "node `lead` runs on driver `command-code`",
    );
  });

  it("is refused by ork run before any session starts", async () => {
    const done = await start(owning("command-code"), {
      drivers: standInDrivers,
    });
    expect(done.exitCode).toBe(1);
    expect(done.started).toEqual([]);
    expect(done.err.join("\n")).toContain(
      "node `lead` runs on driver `command-code`",
    );
  });
});

describe("ork validate's queue warning", () => {
  it("warns, once, on a driver that holds one session per checkout", async () => {
    const found = await driverDiagnostics(shared("command-code"), {
      drivers: standInDrivers,
      checks: unasked,
    });
    expect(found).toMatchObject([
      { severity: "warning", code: "driver.queues", path: ["nodes", "a"] },
    ]);
    expect(found[0]?.message).toContain("driver `command-code`");
  });

  it("is quiet on a driver that runs many sessions at once", async () => {
    expect(
      await driverDiagnostics(shared("claude-code"), {
        drivers: standInDrivers,
        checks: unasked,
      }),
    ).toEqual([]);
  });
});
