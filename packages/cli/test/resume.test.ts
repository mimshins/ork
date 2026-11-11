/**
 * @file Tests for `ork resume`: a failed run continues under its own id, its
 *   finished Claude node keeps its result (no new session), the failed tool
 *   node runs again, runs that are running or succeeded are refused, and what a
 *   `watch:` node's program kept is still there for it; a run stored with the
 *   retired driver ids `cli` and `sdk` reads them as `claude-code` in `ork
 *   resume`, `ork logs` and `ork ps` (RFC-014).
 */

import { existsSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  type EventStore,
  findRun,
  type HumanChannel,
  inRepoPlace,
  openStore,
  resumable,
  runDirOf,
  type RunRecord,
} from "@krapht/ork-core";
import { spawnTool, type ToolRunner } from "@krapht/ork-nodes";
import { createCliRuntime } from "@krapht/ork-runtime";
import { describe, expect, it } from "vitest";

import { followRun, formatRuns, runWorkflowFile } from "../src/index.ts";
import { openCodeReady, standInDrivers } from "./fixtures/drivers.ts";

const FAKE_CLAUDE = path.resolve(
  import.meta.dirname,
  "../../runtime/test/fixtures/fake-claude.mjs",
);

const WORKFLOW = [
  "schemaVersion: 1",
  "name: notes",
  "inputs:",
  "  topic: { type: string, required: true }",
  "nodes:",
  "  write:",
  "    type: agent.worker",
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

const setup = (
  workflow = WORKFLOW,
  store: EventStore = openStore(":memory:"),
) => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-resume-")));
  writeFileSync(path.join(dir, "notes.ork.yaml"), workflow);
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
      driverChecks: openCodeReady,
      drivers: standInDrivers,
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

/** Says what it didn't declare, which ends the wait, until it finds its file. */
const KEEPING = [
  "schemaVersion: 1",
  "name: kept",
  "nodes:",
  "  ci:",
  "    type: tool.shell",
  "    script: |",
  '      if [ -f "$ORK_STATE" ]; then echo \'{"result":"done"}\'; exit 0; fi',
  '      echo kept > "$ORK_STATE"',
  '      echo \'{"result":"nope"}\'',
  "    output:",
  "      format: json",
  "      schema: { result: [pending, done] }",
  "    watch: { every: 5s, until: \"json.result == 'done'\", timeout: 1m }",
  "",
].join("\n");

describe("ork resume", () => {
  it("says what a walk found when the run starts, not again", async () => {
    const s = setup(
      [
        WORKFLOW.replace(
          "edges:",
          '  off:\n    type: tool.shell\n    command: "publish"\nedges:',
        ),
        '  - { from: publish, to: off, when: "false" }',
        "",
      ].join(""),
    );
    const first = await s.run(exits(1));
    expect(first.out.join("\n")).toContain("(walk.never-runs)");
    const record = only(s.store);
    const again = await s.run(exits(0), {
      inputs: [],
      inPlace: true,
      runId: record.id,
      resume: readyToResume(s.store, record).state,
    });
    expect(again.result?.status).toBe("succeeded");
    expect(again.out.join("\n")).not.toContain("(walk.never-runs)");
  });

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

  it("asks a resumed run's questions under new ids, not a store error", async () => {
    const s = setup(
      `${WORKFLOW}  - publish -> check\n`.replace(
        "edges:",
        "  check:\n    type: agent.worker\n    isolation: shared\n    prompt: check\nedges:",
      ),
    );
    expect((await s.run(exits(1))).result?.status).toBe("failed");
    const record = only(s.store);
    const again = await s.run(exits(0), {
      inputs: [],
      inPlace: true,
      runId: record.id,
      resume: readyToResume(s.store, record).state,
    });
    expect(again.result?.status).toBe("succeeded");
    expect(again.out.join("\n")).not.toContain("UNIQUE");
    expect(s.store.decisions({ runId: record.id }).map(d => d.id)).toEqual([
      `${record.id}-1`,
      `${record.id}-2`,
    ]);
  });

  it("keeps what a watching program kept, until the run has succeeded", async () => {
    const s = setup();
    writeFileSync(path.join(s.dir, "kept.ork.yaml"), KEEPING);
    const given = {
      file: "kept.ork.yaml",
      inputs: [],
      tools: spawnTool,
    };
    const first = await s.run(spawnTool, given);
    expect(first.result?.status).toBe("failed");
    const record = only(s.store);
    const kept = path.join(
      runDirOf(inRepoPlace(s.dir), record.id),
      ".state",
      "ci",
    );
    expect(existsSync(kept)).toBe(true);

    const again = await s.run(spawnTool, {
      ...given,
      runId: record.id,
      resume: readyToResume(s.store, record).state,
    });
    // It only passes by finding what the first run left.
    expect(again.result?.status).toBe("succeeded");
    expect(existsSync(path.dirname(kept))).toBe(false);
  });
});

/** What `ork logs` prints for a stored run. */
const logged = async (
  store: EventStore,
  id: string,
  dir: string,
): Promise<string[]> => {
  const found = findRun(store, id, dir);
  if (!found.ok) throw new Error(found.error);
  const lines: string[] = [];
  await followRun(
    store,
    found.run,
    line => {
      lines.push(line);
    },
    { follow: false, json: false },
  );
  return lines;
};

/** Rewrites a stored run's driver ids as a version before RFC-014 wrote them. */
const asStoredBeforeRfc014 = (file: string): string[] => {
  const db = new DatabaseSync(file);
  db.exec(
    `UPDATE events SET data = replace(replace(data,
       '"driver":"claude-code"', '"driver":"cli"'),
       '"readyDriver":"open-code"', '"readyDriver":"sdk"')`,
  );
  const rows = db
    .prepare("SELECT data FROM events")
    .all()
    .map(row => String(row["data"]));
  db.close();
  return rows;
};

describe("a run stored with the retired driver ids", () => {
  it("reads `cli` and `sdk` as claude-code: resume, logs and ps work", async () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "ork-db-")), "o.db");
    const s = setup(WORKFLOW, openStore(file));
    expect((await s.run(exits(1))).result?.status).toBe("failed");
    const stored = asStoredBeforeRfc014(file).join("\n");
    expect(stored).toContain('"driver":"cli"');
    expect(stored).toContain('"readyDriver":"sdk"');

    const record = only(s.store);
    const read = JSON.stringify(s.store.events(record.id, 0));
    expect(read).not.toMatch(/"(driver|readyDriver)":"(cli|sdk)"/u);
    expect(read).toContain('"readyDriver":"claude-code"');

    expect((await logged(s.store, record.id, s.dir)).join("\n")).toContain(
      "write",
    );
    expect(formatRuns(s.store.runs(), false).join("\n")).toContain(record.id);

    const ready = readyToResume(s.store, record);
    expect(ready.state.settings.readyDriver).toBe("claude-code");
    const again = await s.run(exits(0), {
      inputs: [],
      runId: record.id,
      resume: ready.state,
    });
    expect(again.result?.status).toBe("succeeded");
  });
});
