/**
 * @file Tests for `ork run` under the git rules `git.readonly: base` and
 *   `git.fetch`: a workflow whose only isolated node is a readonly one still
 *   needs a git repository and reads a worktree at the base, and a remote
 *   `git.base` is fetched before a new run but not when the run is handed its
 *   base or resumes, and a resumed run reads at the commit it started from.
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  type EventStore,
  type HumanChannel,
  openStore,
  resumable,
} from "@krapht/ork-core";
import { createCliRuntime } from "@krapht/ork-runtime";
import { describe, expect, it } from "vitest";

import { runWorkflowFile, type RunWorkflowOptions } from "../src/index.ts";
import { openCodeReady, standInDrivers } from "./fixtures/drivers.ts";
import {
  cutOff,
  projectWith,
  sh,
  unreachableOrigin,
  withOrigin,
} from "./fixtures/git-origin.ts";

type ToolRunner = NonNullable<RunWorkflowOptions["tools"]>;

const recommending: HumanChannel = {
  ask: ({ recommended }) => Promise.resolve(recommended ?? "none"),
  permit: () => Promise.resolve({ allow: false, message: "no" }),
};

const FAKE_CLAUDE = path.resolve(
  import.meta.dirname,
  "../../runtime/test/fixtures/fake-claude.mjs",
);

const workflowOf = (git: string) =>
  [
    "schemaVersion: 1",
    "name: scout",
    `rules: { git: { ${git} } }`,
    "nodes:",
    "  scout: { type: agent.worker, isolation: readonly, prompt: Read }",
    "",
  ].join("\n");

/** `gate`, then `scout` reading at the base, then `probe`. */
const GATED = [
  "schemaVersion: 1",
  "name: scout",
  "rules: { git: { readonly: base, base: origin/main } }",
  "nodes:",
  "  gate: { type: tool.shell, command: gate }",
  "  scout: { type: agent.worker, isolation: readonly, prompt: Read }",
  "  probe: { type: tool.shell, command: probe }",
  "edges:",
  "  - gate -> scout",
  "  - scout -> probe",
  "",
].join("\n");

/**
 * Tools where `gate` exits `state.gate`, and `probe` records the commit of the
 * folder `state.read` names (the run's read-only worktree).
 */
const probing =
  (state: { gate: number; read: string; heads: string[] }): ToolRunner =>
  (program, args) => {
    const line = [program, ...args].join(" ");
    const probed = line.includes("probe");
    if (probed) state.heads.push(sh(state.read, "rev-parse", "HEAD").trim());
    return Promise.resolve({
      exitCode: line.includes("gate") ? state.gate : 0,
      stdout: "",
      stderr: "",
    });
  };

/** The only run in `store`, ready to resume. */
const resumeOf = (store: EventStore): Partial<RunWorkflowOptions> => {
  const [record] = store.runs();
  if (record === undefined) throw new Error("no run");
  const ready = resumable(store, record, {});
  if (!ready.ok) throw new Error(ready.error);
  return { runId: record.id, resume: ready.state, inputs: [] };
};

/** A resume of a run recorded before `git.fetch`, which kept no `baseRef`. */
const withoutBaseRef = (
  given: Partial<RunWorkflowOptions>,
): Partial<RunWorkflowOptions> => {
  if (given.resume === undefined) throw new Error("no resume state");
  const { baseRef: _dropped, ...settings } = given.resume.settings;
  return { ...given, resume: { ...given.resume, settings } };
};

/** A first run of GATED that fails at `gate`, and what a resume needs. */
const failedOnce = async () => {
  const dir = projectWith(GATED, true);
  withOrigin(dir);
  const store = openStore(":memory:");
  const home = mkdtempSync(path.join(tmpdir(), "ork-home-"));
  const state = { gate: 1, read: "", heads: [] as string[] };
  const shared = { store, home, tools: probing(state) };
  const first = await run(dir, shared);
  const runId = String(first.result?.runId);
  state.gate = 0;
  state.read = path.join(`${dir}-worktrees`, `ork-${runId}-_readonly`);
  const resume = (change = (given: Partial<RunWorkflowOptions>) => given) =>
    run(dir, { ...shared, ...change(resumeOf(store)) });
  return { dir, first, state, store, resume };
};

const run = async (
  cwd: string,
  overrides: Partial<RunWorkflowOptions> = {},
) => {
  const out: string[] = [];
  const err: string[] = [];
  const finished = await runWorkflowFile({
    file: "scout.ork.yaml",
    cwd,
    inputs: [],
    inPlace: false,
    json: false,
    runtime: () => Promise.resolve(createCliRuntime({ bin: FAKE_CLAUDE })),
    driverChecks: openCodeReady,
    drivers: standInDrivers,
    human: recommending,
    store: openStore(":memory:"),
    home: mkdtempSync(path.join(tmpdir(), "ork-home-")),
    out: line => {
      out.push(line);
    },
    err: line => {
      err.push(line);
    },
    installed: () => true,
    ...overrides,
  });
  return { ...finished, out: out.join("\n"), err };
};

describe("a readonly-only workflow under git.readonly: base", () => {
  it("reads a worktree at the base, opened and removed by the run", async () => {
    const dir = projectWith(workflowOf("readonly: base"), true);
    const { exitCode, result, out } = await run(dir);
    expect(exitCode).toBe(0);
    const read = path.join(
      `${dir}-worktrees`,
      `ork-${String(result?.runId)}-_readonly`,
    );
    expect(out).toContain(read);
    expect(sh(dir, "worktree", "list")).not.toContain(read);
  });

  it("opens no worktree with --in-place", async () => {
    const dir = projectWith(workflowOf("readonly: base"), true);
    const { exitCode, out } = await run(dir, { inPlace: true });
    expect(exitCode).toBe(0);
    expect(out).not.toContain("-worktrees");
    expect(sh(dir, "worktree", "list").trim().split("\n")).toHaveLength(1);
  });

  it("needs a git repository, as a worktree node does", async () => {
    const dir = projectWith(workflowOf("readonly: base"), false);
    const { exitCode, err } = await run(dir);
    expect(exitCode).toBe(1);
    expect(err.at(-1)).toMatch(
      /^scout needs a git worktree, but .+ is not in a git repository with a commit/u,
    );
  });
});

describe("a remote git.base", () => {
  it("is fetched before a new run, which stops when the fetch fails", async () => {
    const dir = projectWith(
      workflowOf("readonly: base, base: origin/main"),
      true,
    );
    unreachableOrigin(dir);
    const { exitCode, result, err } = await run(dir);
    expect(exitCode).toBe(1);
    expect(result).toBeNull();
    expect(err.at(-1)).toMatch(
      /^git fetch origin main failed: .+ \(git\.base is origin\/main; set git\.fetch: never to skip the fetch\)$/u,
    );
  });

  it("is not fetched when the run is handed its base", async () => {
    const dir = projectWith(
      workflowOf("readonly: base, base: origin/main"),
      true,
    );
    unreachableOrigin(dir);
    const head = sh(dir, "rev-parse", "HEAD").trim();
    const { exitCode } = await run(dir, { baseRef: head });
    expect(exitCode).toBe(0);
  });

  it("is not fetched when a run resumes", async () => {
    const s = await failedOnce();
    expect(s.first.exitCode).toBe(1);
    cutOff(s.dir);
    const again = await s.resume();
    expect(again.err.join("\n")).not.toContain("git fetch");
    expect(again.exitCode).toBe(0);
  });

  it("stays the commit the run started from when it resumes", async () => {
    const s = await failedOnce();
    const started = sh(s.dir, "rev-parse", "origin/main").trim();
    // The remote moves on, and this clone fetches it.
    writeFileSync(path.join(s.dir, "later.txt"), "later\n");
    sh(s.dir, "add", "-A");
    sh(s.dir, "commit", "-q", "-m", "later");
    sh(s.dir, "push", "-q", "origin", "HEAD:main");
    expect(sh(s.dir, "rev-parse", "origin/main").trim()).not.toBe(started);
    const again = await s.resume();
    expect(again.exitCode).toBe(0);
    expect(s.state.heads).toEqual([started]);
  });

  it("resolves locally, with no fetch, when a run started before git.fetch has no recorded base", async () => {
    const s = await failedOnce();
    const recorded = resumeOf(s.store).resume?.settings.baseRef;
    expect(recorded).toBeDefined();
    // The remote moves on, and this clone has it; the origin is then cut off.
    writeFileSync(path.join(s.dir, "later.txt"), "later\n");
    sh(s.dir, "add", "-A");
    sh(s.dir, "commit", "-q", "-m", "later");
    sh(s.dir, "push", "-q", "origin", "HEAD:main");
    cutOff(s.dir);
    const local = sh(s.dir, "rev-parse", "origin/main").trim();
    expect(local).not.toBe(recorded);
    const again = await s.resume(withoutBaseRef);
    expect(again.err.join("\n")).not.toContain("git fetch");
    expect(again.exitCode).toBe(0);
    expect(s.state.heads).toEqual([local]);
  });
});
