/**
 * @file Tests for `ork resume`: a failed run continues under its own id, its
 *   finished Claude node keeps its result (no new session), the failed tool
 *   node runs again, and runs that are running or succeeded are refused.
 */

import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  type EventStore,
  type HumanChannel,
  openStore,
  type RunRecord,
} from "@krapht/ork-core";
import type { ToolRunner } from "@krapht/ork-nodes";
import { createCliRuntime } from "@krapht/ork-runtime-claude";
import { describe, expect, it } from "vitest";

import { resumable, runWorkflowFile } from "../src/index.ts";

const FAKE_CLAUDE = path.resolve(
  import.meta.dirname,
  "../../runtime-claude/test/fixtures/fake-claude.mjs",
);

const WORKFLOW = [
  "schemaVersion: 1",
  "name: notes",
  "inputs:",
  "  topic: { type: string, required: true }",
  "nodes:",
  "  write:",
  "    type: claude.worker",
  "    isolation: shared",
  '    prompt: "Write about {{inputs.topic}}"',
  "  publish:",
  "    type: tool.shell",
  '    command: "publish"',
  "edges:",
  "  - write -> publish",
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

const setup = () => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-resume-")));
  writeFileSync(path.join(dir, "notes.ork.yaml"), WORKFLOW);
  const store: EventStore = openStore(":memory:");
  const home = mkdtempSync(path.join(tmpdir(), "ork-home-"));
  const run = async (
    tools: ToolRunner,
    extra: Partial<Parameters<typeof runWorkflowFile>[0]> = {},
  ) => {
    const out: string[] = [];
    const finished = await runWorkflowFile({
      file: "notes.ork.yaml",
      cwd: dir,
      inputs: ["topic=owls"],
      inPlace: true,
      json: false,
      runtime: () => Promise.resolve(createCliRuntime({ bin: FAKE_CLAUDE })),
      human: recommending,
      store,
      home,
      out: line => {
        out.push(line);
      },
      err: line => {
        out.push(line);
      },
      tools,
      installed: () => true,
      ...extra,
    });
    return { ...finished, out };
  };
  return { dir, store, run };
};

const only = (store: EventStore): RunRecord => {
  const [record] = store.runs();
  if (record === undefined) throw new Error("no run");
  return record;
};

/** The run's resume state, which it must have. */
const readyToResume = (store: EventStore, record: RunRecord) => {
  const ready = resumable(store, record, {});
  if (!ready.ok) throw new Error(ready.error);
  return ready;
};

describe("ork resume", () => {
  it("continues a failed run: finished nodes keep their results", async () => {
    const s = setup();
    const first = await s.run(exits(1));
    expect(first.result?.status).toBe("failed");
    const record = only(s.store);
    const ready = readyToResume(s.store, record);
    expect(ready.inPlace).toBe(true);
    expect(ready.state.inputs).toEqual({ topic: "owls" });

    const again = await s.run(exits(0), {
      inputs: [],
      inPlace: ready.inPlace,
      runId: record.id,
      resume: ready.state,
    });
    expect(again.result?.status).toBe("succeeded");
    expect(again.out).toContain("▸ resumed: write keeps its result");
    // The worker's session did not run again.
    expect(again.out.join("\n")).not.toContain("Working on");
    expect(s.store.runs()).toHaveLength(1);
    expect(only(s.store).status).toBe("succeeded");
    expect(resumable(s.store, only(s.store), {})).toEqual({
      ok: false,
      error: `Run ${record.id} succeeded; there is nothing to resume.`,
    });
  });
});
