/**
 * @file Tests for recorded runs: `ork run` writes to the store, `ork logs`
 *   replays the same transcript, `ork tree` and `ork ps` read it back, and a
 *   workflow whose tool programs are missing does not start.
 */

import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { type HumanChannel, openStore, runTree } from "@krapht/ork-core";
import { createCliRuntime } from "@krapht/ork-runtime-claude";
import { describe, expect, it } from "vitest";

import {
  ago,
  duration,
  findRun,
  followRun,
  formatRuns,
  formatTree,
  runWorkflowFile,
  type RunWorkflowOptions,
} from "../src/index.ts";

const FAKE_CLAUDE = path.resolve(
  import.meta.dirname,
  "../../runtime-claude/test/fixtures/fake-claude.mjs",
);

const WORKFLOW = [
  "schemaVersion: 1",
  "name: notes",
  "nodes:",
  "  write:",
  "    type: claude.worker",
  "    isolation: shared",
  '    prompt: "Write the notes"',
  "  publish:",
  "    type: tool.shell",
  '    command: "echo done"',
  "  push:",
  "    type: tool.gh",
  '    command: "pr view"',
  "edges:",
  "  - write -> publish",
  "  - from: publish",
  "    to: push",
  "    when: exitCode == 1",
  "",
].join("\n");

/** The workflow without its `tool.gh` node. */
const WITHOUT_GH = [
  ...WORKFLOW.split("\n").slice(0, WORKFLOW.split("\n").indexOf("  push:")),
  "edges:",
  "  - write -> publish",
  "",
].join("\n");

const recommending: HumanChannel = {
  ask: ({ recommended }) => Promise.resolve(recommended ?? "none"),
  permit: () => Promise.resolve({ allow: false, message: "no" }),
};

const setup = (overrides: Partial<RunWorkflowOptions> = {}) => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-runs-")));
  writeFileSync(path.join(dir, "notes.ork.yaml"), WORKFLOW);
  const out: string[] = [];
  const err: string[] = [];
  const store = openStore(":memory:");
  const value: RunWorkflowOptions = {
    file: "notes.ork.yaml",
    cwd: dir,
    inputs: [],
    inPlace: true,
    json: false,
    runtime: () => Promise.resolve(createCliRuntime({ bin: FAKE_CLAUDE })),
    human: recommending,
    store,
    home: mkdtempSync(path.join(tmpdir(), "ork-home-")),
    out: line => {
      out.push(line);
    },
    err: line => {
      err.push(line);
    },
    tools: () => Promise.resolve({ exitCode: 0, stdout: "done", stderr: "" }),
    installed: () => true,
    ...overrides,
  };
  return { dir, out, err, store, value };
};

/** Every line `ork logs` prints for the newest run in `dir`. */
const logLines = async (s: ReturnType<typeof setup>, node?: string) => {
  const found = findRun(s.store, undefined, s.dir);
  if (!found.ok) throw new Error(found.error);
  const lines: string[] = [];
  await followRun(
    s.store,
    found.run,
    line => {
      lines.push(line);
    },
    { follow: false, json: false, ...(node === undefined ? {} : { node }) },
  );
  return { run: found.run, lines };
};

describe("a recorded run", () => {
  it("is in the store, and `ork logs` prints what `ork run` printed", async () => {
    const s = setup();
    const { exitCode, result } = await runWorkflowFile(s.value);
    expect(exitCode).toBe(0);
    const { run, lines } = await logLines(s);
    expect(run).toMatchObject({
      id: result?.runId,
      workflow: "notes",
      status: "succeeded",
      project: s.dir,
    });
    expect(lines).toEqual(s.out);
    const publishOnly = await logLines(s, "publish");
    expect(publishOnly.lines.length).toBeGreaterThan(0);
    expect(publishOnly.lines.every(l => l.includes("publish"))).toBe(true);
  });

  it("draws the ownership tree and lists the run in `ork ps`", async () => {
    const s = setup();
    await runWorkflowFile(s.value);
    const { run } = await logLines(s);
    const roots = runTree(s.store.events(run.id).map(e => e.event));
    expect(roots.map(r => `${r.id} ${r.state}`)).toEqual([
      "write ok",
      "publish ok",
      "push skipped",
    ]);
    expect(formatTree(roots)).toHaveLength(3);
    const table = formatRuns(s.store.runs(), false);
    expect(table).toHaveLength(2);
    expect(table[1]).toContain("succeeded");
  });

  it("does not start when a tool node's program is not installed", async () => {
    const s = setup({ installed: program => program !== "gh" });
    const { exitCode } = await runWorkflowFile(s.value);
    expect(exitCode).toBe(1);
    expect(s.err.join("\n")).toContain("gh, for push (tool.gh)");
    expect(s.store.runs()).toEqual([]);
  });

  it("starts without the integrations the workflow does not use", async () => {
    const s = setup({
      installed: program => program === "echo",
    });
    writeFileSync(path.join(s.dir, "notes.ork.yaml"), WITHOUT_GH);
    expect((await runWorkflowFile(s.value)).exitCode).toBe(0);
  });
});

describe("run lookup and formatting", () => {
  it("finds a run by prefix and says when it is ambiguous or missing", () => {
    const store = openStore(":memory:");
    for (const id of ["aa11", "aa22"]) {
      store.begin({ id, workflow: "w", file: "/w", project: "/p" });
    }
    expect(findRun(store, "aa1", "/p")).toMatchObject({ ok: true });
    expect(findRun(store, "aa", "/p")).toEqual({
      ok: false,
      error: '"aa" matches 2 runs: aa22, aa11',
    });
    expect(findRun(store, "zz", "/p")).toEqual({
      ok: false,
      error: 'No run "zz".',
    });
  });

  it("says how long ago and for how long", () => {
    const now = Date.parse("2026-10-30T12:00:00Z");
    expect(
      [
        "2026-10-30T11:59:40Z",
        "2026-10-30T11:10:00Z",
        "2026-10-29T09:00:00Z",
        "2026-09-01T00:00:00Z",
      ].map(t => ago(t, now)),
    ).toEqual(["just now", "50m ago", "1d ago", "2026-09-01"]);
    expect([42_000, 192_000, 3_900_000].map(ms => duration(ms))).toEqual([
      "42s",
      "3m12s",
      "1h05m",
    ]);
  });
});
