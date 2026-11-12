/**
 * @file Tests for the driver a run takes when nothing names one: the one ready
 *   on this machine (`cli` when both are), said in one line; no run when none
 *   is; anything that names a driver still wins; and a resume keeps the driver
 *   the run recorded. Driver checks and the runtime are fakes.
 */

import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  type AgentRuntime,
  type EventStore,
  type HumanChannel,
  openStore,
  resumable,
} from "@krapht/ork-core";
import type { ToolRunner } from "@krapht/ork-nodes";
import { createCliRuntime } from "@krapht/ork-runtime";
import { parseWorkflow, type Workflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import {
  badDriver,
  type DriverChecks,
  runReadyDriver,
  runWorkflowFile,
} from "../src/index.ts";
import { readyOnly, standInDrivers } from "./fixtures/drivers.ts";

const FAKE_CLAUDE = path.resolve(
  import.meta.dirname,
  "../../runtime/test/fixtures/fake-claude.mjs",
);

/** A workflow of a writer and a reviewer, with `extra` lines under nodes. */
const text = (writer = "", reviewer = "", defaults = "") =>
  [
    "schemaVersion: 1",
    "name: notes",
    ...(defaults === "" ? [] : ["defaults:", `  ${defaults}`]),
    "nodes:",
    "  write:",
    "    type: agent.worker",
    "    isolation: shared",
    '    prompt: "Write"',
    ...(writer === "" ? [] : [`    ${writer}`]),
    "  review:",
    "    type: agent.worker",
    "    isolation: shared",
    '    prompt: "Review"',
    ...(reviewer === "" ? [] : [`    ${reviewer}`]),
    "  publish:",
    "    type: tool.shell",
    '    command: "publish"',
    "edges:",
    "  - write -> review",
    "  - review -> publish",
    "",
  ].join("\n");

const workflowOf = (yaml: string): Workflow => {
  const parsed = parseWorkflow(yaml);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return parsed.workflow;
};

/** Checks that fail the test if anything runs them. */
const unasked: DriverChecks = () =>
  Promise.reject(new Error("the drivers' checks ran"));

const recommending: HumanChannel = {
  ask: ({ recommended }) => Promise.resolve(recommended ?? "none"),
  permit: () => Promise.resolve({ allow: false, message: "no" }),
};

const exits =
  (code: number): ToolRunner =>
  () =>
    Promise.resolve({ exitCode: code, stdout: "", stderr: "" });

/** Runs `yaml` with fake checks and runtime; says which drivers started. */
const setup = (yaml: string) => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-driver-")));
  writeFileSync(path.join(dir, "notes.ork.yaml"), yaml);
  const store: EventStore = openStore(":memory:");
  const home = mkdtempSync(path.join(tmpdir(), "ork-home-"));
  const run = async (
    checks: DriverChecks,
    extra: Partial<Parameters<typeof runWorkflowFile>[0]> = {},
    code = 0,
  ) => {
    const err: string[] = [];
    const drivers: string[] = [];
    const runtime = (driver: string): Promise<AgentRuntime> => {
      drivers.push(driver);
      return Promise.resolve(createCliRuntime({ bin: FAKE_CLAUDE }));
    };
    const done = await runWorkflowFile({
      file: "notes.ork.yaml",
      cwd: dir,
      inputs: [],
      inPlace: true,
      json: false,
      runtime,
      driverChecks: checks,
      drivers: standInDrivers,
      human: recommending,
      store,
      home,
      tools: exits(code),
      out: () => {
        // The transcript isn't what these check.
      },
      err: line => {
        err.push(line);
      },
      ...extra,
    });
    return { ...done, err, drivers };
  };
  const settingsOf = (runId: string) =>
    store
      .events(runId, 0)
      .map(({ event }) => event)
      .find(event => event.type === "run.started")?.settings;
  return { run, store, settingsOf };
};

/** What `ork resume` reads back for the run `runId`. */
const resumeOf = (store: EventStore, runId: string) => {
  const record = store.runs().find(({ id }) => id === runId);
  const ready = record === undefined ? undefined : resumable(store, record, {});
  if (ready?.ok !== true) throw new Error(`can't resume ${runId}`);
  return ready.state;
};

describe("the driver for nodes that name none", () => {
  it.each([
    [
      "only cli is ready",
      readyOnly("claude-code"),
      "claude-code",
      "the one ready here (claude-code is ready)",
    ],
    [
      "only sdk is ready",
      readyOnly("open-code"),
      "open-code",
      "the one ready here (open-code is ready)",
    ],
    [
      "both are ready",
      readyOnly("open-code", "claude-code"),
      "claude-code",
      "more than one is ready, and a run takes claude-code first",
    ],
  ])(
    "is the one ready when %s, said in one line",
    async (_case, checks, driver, why) => {
      const { run, settingsOf } = setup(text());
      const done = await run(checks);

      expect(done.exitCode).toBe(0);
      expect(done.drivers).toEqual([driver, driver]);
      expect(done.err).toContain(
        `No driver is named, so the run uses the ${driver} driver: ${why}.`,
      );
      expect(settingsOf(String(done.result?.runId))).toMatchObject({
        readyDriver: driver,
      });
    },
  );

  it("stops the run before any session starts when none is ready", async () => {
    const { run, store } = setup(text());
    const done = await run(readyOnly());

    expect(done.exitCode).toBe(1);
    expect(done.drivers).toEqual([]);
    expect(store.runs()).toEqual([]);
    expect(done.err).toEqual([
      "No agent driver is ready here, and write, review name none.",
      "Get the open-code driver ready.",
      "Get the claude-code driver ready.",
      "See `ork doctor`.",
    ]);
  });

  it("is only for the nodes that name none", async () => {
    const { run } = setup(text("driver: open-code"));
    const done = await run(readyOnly("claude-code"));

    expect(done.drivers).toEqual(["open-code", "claude-code"]);
    expect(done.err).toContain(
      "review names no driver, so it uses the claude-code driver: the one ready here (claude-code is ready).",
    );
  });

  it("isn't looked for when the workflow names one", async () => {
    const { run, settingsOf } = setup(text("", "", "driver: open-code"));
    const done = await run(unasked);

    expect(done.exitCode).toBe(0);
    expect(done.drivers).toEqual(["open-code", "open-code"]);
    expect(settingsOf(String(done.result?.runId))).not.toHaveProperty(
      "readyDriver",
    );
  });

  it("isn't looked for when --driver names one, only that one is checked", async () => {
    const { run } = setup(text("driver: open-code"));
    const asked: (string | undefined)[] = [];
    const done = await run(
      only => {
        asked.push(only);
        return readyOnly("claude-code")();
      },
      { driver: "claude-code" },
    );

    expect(done.exitCode).toBe(0);
    expect(done.drivers).toEqual(["claude-code", "claude-code"]);
    expect(asked).toEqual(["claude-code"]);
  });

  it("stops before any session when --driver's tool isn't ready", async () => {
    const { run } = setup(text());
    const done = await run(readyOnly("open-code"), { driver: "claude-code" });

    expect(done.exitCode).toBe(1);
    expect(done.drivers).toEqual([]);
    expect(done.err).toEqual([
      "--driver claude-code: claude-code isn't ready here (claude-code is not ready).",
      "Get the claude-code driver ready.",
      "See `ork doctor`.",
    ]);
  });

  it("stops a resume on --driver the same way", async () => {
    const { run, store } = setup(text());
    const first = await run(readyOnly("claude-code"), {}, 1);
    const runId = String(first.result?.runId);
    const again = await run(readyOnly("open-code"), {
      runId,
      resume: resumeOf(store, runId),
      driver: "claude-code",
    });
    expect(again.exitCode).toBe(1);
    expect(again.err.join("\n")).toContain("--driver claude-code:");
  });

  it("stays the one the run recorded when it resumes", async () => {
    const { run, store } = setup(text());
    const first = await run(readyOnly("claude-code"), {}, 1);
    expect(first.result?.status).toBe("failed");
    const runId = String(first.result?.runId);
    const again = await run(unasked, {
      runId,
      resume: resumeOf(store, runId),
    });
    expect(again.result?.status).toBe("succeeded");
    expect(again.err.join("\n")).not.toContain("driver");
  });
});

describe("runReadyDriver", () => {
  it("takes the recorded driver without looking", async () => {
    expect(
      await runReadyDriver(workflowOf(text()), {
        recorded: "open-code",
        checks: unasked,
      }),
    ).toEqual({ ok: true, driver: "open-code" });
  });

  it("needs nothing when every session node names one", async () => {
    expect(
      await runReadyDriver(
        workflowOf(text("driver: claude-code", "driver: open-code")),
        {
          checks: unasked,
        },
      ),
    ).toEqual({ ok: true });
  });
});

describe("--driver", () => {
  it("names the replacement of a retired id, and the ids otherwise", () => {
    expect(badDriver("sdk")).toBe(
      "--driver `sdk` was retired; use `claude-code`",
    );
    expect(badDriver("cli")).toBe(
      "--driver `cli` was retired; use `claude-code`",
    );
    expect(badDriver("x")).toBe(
      "--driver must be one of claude-code, open-code, command-code, got `x`",
    );
  });
});
