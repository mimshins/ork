/**
 * @file Tests for `ork run --machine-claude` (ADR-065): the run records it, its
 *   sessions load the machine's Claude setup, `ork resume` and `ork chat` keep
 *   it, and a run without it, or recorded before it existed, stays clean. The
 *   runtime is the stand-in `claude`, watched for the specs it is given.
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
  type SessionSpec,
} from "@krapht/ork-core";
import type { ToolRunner } from "@krapht/ork-nodes";
import { createCliRuntime } from "@krapht/ork-runtime";
import { describe, expect, it } from "vitest";

import { resumeChat, runWorkflowFile } from "../src/index.ts";
import { readyOnly } from "./fixtures/drivers.ts";

const FAKE_CLAUDE = path.resolve(
  import.meta.dirname,
  "../../runtime/test/fixtures/fake-claude.mjs",
);

const WORKFLOW = [
  "schemaVersion: 1",
  "name: notes",
  "nodes:",
  "  gather:",
  "    type: tool.shell",
  '    command: "gather"',
  "  write:",
  "    type: agent.worker",
  "    isolation: shared",
  '    prompt: "Write"',
  "edges:",
  "  - gather -> write",
  "",
].join("\n");

const recommending: HumanChannel = {
  ask: ({ recommended }) => Promise.resolve(recommended ?? "none"),
  permit: () => Promise.resolve({ allow: false, message: "no" }),
};

const exits =
  (code: number): ToolRunner =>
  () =>
    Promise.resolve({ exitCode: code, stdout: "", stderr: "" });

const quiet = () => {
  // The transcript isn't what these check.
};

/** The stand-in `claude`, keeping each session's spec. */
const watched = (specs: SessionSpec[]) => (): Promise<AgentRuntime> => {
  const inner = createCliRuntime({ bin: FAKE_CLAUDE });
  return Promise.resolve({
    driver: "claude-code",
    start: (spec, ports) => {
      specs.push(spec);
      return inner.start(spec, ports);
    },
  });
};

const setup = () => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-machine-")));
  writeFileSync(path.join(dir, "notes.ork.yaml"), WORKFLOW);
  const store: EventStore = openStore(":memory:");
  const home = mkdtempSync(path.join(tmpdir(), "ork-home-"));
  const specs: SessionSpec[] = [];
  const run = (
    extra: Partial<Parameters<typeof runWorkflowFile>[0]> = {},
    code = 0,
  ) =>
    runWorkflowFile({
      file: "notes.ork.yaml",
      cwd: dir,
      inputs: [],
      inPlace: true,
      json: false,
      runtime: watched(specs),
      driverChecks: readyOnly("claude-code"),
      human: recommending,
      store,
      home,
      tools: exits(code),
      out: quiet,
      err: quiet,
      ...extra,
    });
  const settingsOf = (runId: string) =>
    store
      .events(runId, 0)
      .map(({ event }) => event)
      .find(event => event.type === "run.started")?.settings;
  const recordOf = (runId: string) => {
    const record = store.runs().find(({ id }) => id === runId);
    if (record === undefined) throw new Error(`no run ${runId}`);
    return record;
  };
  /** What `ork resume` reads back for the run `runId`. */
  const resumeOf = (runId: string) => {
    const ready = resumable(store, recordOf(runId), {});
    if (!ready.ok) throw new Error(`can't resume ${runId}`);
    return ready.state;
  };
  /** Runs once with `gather` failing, then resumes the run with no flag. */
  const failThenResume = async (
    extra: Partial<Parameters<typeof runWorkflowFile>[0]>,
  ) => {
    const first = await run(extra, 1);
    const runId = String(first.result?.runId);
    specs.length = 0;
    await run({ runId, resume: resumeOf(runId) });
    return runId;
  };
  return { run, store, specs, settingsOf, recordOf, failThenResume };
};

describe("ork run --machine-claude", () => {
  it("records it, and starts the run's sessions with the machine's Claude setup", async () => {
    const { run, specs, settingsOf } = setup();
    const done = await run({ machineClaude: true });

    expect(done.exitCode).toBe(0);
    expect(specs.map(spec => spec.machineClaude)).toEqual([true]);
    expect(settingsOf(String(done.result?.runId))).toMatchObject({
      machineClaude: true,
    });
  });

  it("starts clean sessions without it, and records nothing", async () => {
    const { run, specs, settingsOf } = setup();
    const done = await run();

    expect(specs.map(spec => spec.machineClaude)).toEqual([undefined]);
    expect(settingsOf(String(done.result?.runId))).not.toHaveProperty(
      "machineClaude",
    );
  });

  it("is kept by ork resume, which takes no flag for it", async () => {
    const { specs, failThenResume, settingsOf } = setup();
    const runId = await failThenResume({ machineClaude: true });

    expect(specs.map(spec => spec.machineClaude)).toEqual([true]);
    expect(settingsOf(runId)).toMatchObject({ machineClaude: true });
  });

  it("resumes a run that recorded nothing with clean sessions", async () => {
    const { specs, failThenResume } = setup();
    await failThenResume({});

    expect(specs.map(spec => spec.machineClaude)).toEqual([undefined]);
  });

  it("is kept by ork chat when it resumes a finished node's session", async () => {
    const { run, store, specs, recordOf } = setup();
    const done = await run({ machineClaude: true });
    const record = recordOf(String(done.result?.runId));
    specs.length = 0;

    const failure = await resumeChat({
      store,
      run: record,
      node: "write",
      body: "One more line.",
      runtime: watched(specs),
      human: recommending,
      out: quiet,
    });

    expect(failure).toBeNull();
    expect(specs.map(spec => spec.machineClaude)).toEqual([true]);
  });
});
