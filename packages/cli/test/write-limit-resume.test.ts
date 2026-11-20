/**
 * @file Tests for a run's write limit (`writeOnly`, as `ork feedback apply`
 *   sets it under `knowledge: ork-only`) across `ork resume`: the run records
 *   it, and a resumed run's sessions are held to it again with no option. The
 *   runtime is the stand-in `claude`, watched for the specs it is given.
 */

import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  type AgentRuntime,
  type HumanChannel,
  openStore,
  resumable,
  type SessionSpec,
} from "@krapht/ork-core";
import type { ToolRunner } from "@krapht/ork-nodes";
import { createCliRuntime } from "@krapht/ork-runtime";
import { describe, expect, it } from "vitest";

import { runWorkflowFile } from "../src/index.ts";
import { readyOnly } from "./fixtures/drivers.ts";

const FAKE_CLAUDE = path.resolve(
  import.meta.dirname,
  "../../runtime/test/fixtures/fake-claude.mjs",
);

const WORKFLOW = [
  "schemaVersion: 1",
  "name: fix",
  "nodes:",
  "  gather:",
  "    type: tool.shell",
  '    command: "gather"',
  "  fix:",
  "    type: agent.worker",
  "    isolation: shared",
  '    prompt: "Fix it"',
  "edges:",
  "  - gather -> fix",
  "",
].join("\n");

const recommending: HumanChannel = {
  ask: ({ recommended }) => Promise.resolve(recommended ?? "none"),
  permit: () => Promise.resolve({ allow: false, message: "no" }),
};

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

/** Runs once with `gather` failing, then resumes it as `ork resume` does. */
const failThenResume = async (
  extra: Partial<Parameters<typeof runWorkflowFile>[0]>,
) => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-limit-")));
  writeFileSync(path.join(dir, "fix.ork.yaml"), WORKFLOW);
  const store = openStore(":memory:");
  const home = mkdtempSync(path.join(tmpdir(), "ork-home-"));
  const specs: SessionSpec[] = [];
  const run = (
    more: Partial<Parameters<typeof runWorkflowFile>[0]>,
    code = 0,
  ) =>
    runWorkflowFile({
      file: "fix.ork.yaml",
      cwd: dir,
      inputs: [],
      inPlace: true,
      json: false,
      runtime: watched(specs),
      driverChecks: readyOnly("claude-code"),
      human: recommending,
      store,
      home,
      tools: (): ReturnType<ToolRunner> =>
        Promise.resolve({ exitCode: code, stdout: "", stderr: "" }),
      out: quiet,
      err: quiet,
      ...more,
    });
  const first = await run(extra, 1);
  const runId = String(first.result?.runId);
  const record = store.runs().find(({ id }) => id === runId);
  const ready = record === undefined ? undefined : resumable(store, record, {});
  if (ready?.ok !== true) throw new Error(`can't resume ${runId}`);
  await run({ runId, resume: ready.state });
  const settings = store
    .events(runId, 0)
    .map(({ event }) => event)
    .find(event => event.type === "run.started")?.settings;
  return { specs, settings };
};

describe("a run's write limit", () => {
  it("is recorded, and kept by ork resume, which takes no option for it", async () => {
    const { specs, settings } = await failThenResume({ writeOnly: [".ork"] });

    expect(settings).toMatchObject({ writeOnly: [".ork"] });
    expect(specs.map(spec => spec.writeOnly)).toEqual([[".ork"]]);
  });

  it("is not set on a resumed run that recorded none", async () => {
    const { specs, settings } = await failThenResume({});

    expect(settings).not.toHaveProperty("writeOnly");
    expect(specs.map(spec => spec.writeOnly)).toEqual([undefined]);
  });
});
