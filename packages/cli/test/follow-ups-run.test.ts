/**
 * @file Tests for follow-ups in a run: `--follow-ups` takes `agent` follow-ups
 *   as the run's `brief` and marks them taken by it (refusing what it can't
 *   take, and changing nothing then), a session's `follow_up` call is kept in
 *   the run's project, and `ork follow-ups published` inside the run finishes
 *   what it took.
 */

import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  type EventStore,
  type HumanChannel,
  type FollowUp,
  followUpStore,
  openStore,
  recordPublished,
} from "@krapht/ork-core";
import { createCliRuntime } from "@krapht/ork-runtime";
import { describe, expect, it, vi } from "vitest";

import { prepareFollowUps } from "../src/follow-ups/brief.ts";
import { followUpSink } from "../src/follow-ups/context.ts";
import { runWorkflowFile } from "../src/index.ts";
import { openCodeReady, standInDrivers } from "./fixtures/drivers.ts";

const FAKE_CLAUDE = path.resolve(
  import.meta.dirname,
  "../../runtime/test/fixtures/fake-claude.mjs",
);

const WITH_BRIEF = [
  "schemaVersion: 1",
  "name: take",
  "inputs:",
  "  brief:",
  "    type: string",
  "    required: true",
  "nodes:",
  "  write:",
  "    type: agent.worker",
  "    isolation: shared",
  '    prompt: "Do: {{inputs.brief}}"',
  "",
].join("\n");

const WITHOUT_BRIEF = WITH_BRIEF.replace(
  /inputs:\n {2}brief:\n {4}type: string\n {4}required: true\n/u,
  "",
).replace("Do: {{inputs.brief}}", "Do it");

/** Answers the fake session's question with its recommendation. */
const agreeing: HumanChannel = {
  ask: () => Promise.resolve("a"),
  permit: () => Promise.resolve({ allow: true }),
};

type World = { dir: string; store: EventStore; home: string };

const world = (workflow: string): World => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-fur-")));
  writeFileSync(path.join(dir, "take.ork.yaml"), workflow);
  const home = mkdtempSync(path.join(tmpdir(), "ork-fur-home-"));
  return { dir, store: openStore(":memory:"), home };
};

const addFollowUp = async (
  w: World,
  title: string,
  patch: { for?: "agent" | "me"; kind?: "change" | "task" } = {},
): Promise<FollowUp> =>
  (
    await followUpStore({ rows: w.store, project: w.dir, home: w.home }).add({
      title,
      body: `${title}: the details`,
      for: patch.for ?? "agent",
      kind: patch.kind ?? "change",
      due: "now",
      where: ["src/a.ts"],
    })
  ).followUp;

/** What `ork run take.ork.yaml --follow-ups <ids>` printed to stderr. */
const prepared = (w: World, ids: readonly string[]) => {
  const lines: string[] = [];
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(text => {
    lines.push(String(text).trimEnd());
    return true;
  });
  try {
    const taking = prepareFollowUps(
      w.store,
      ["--follow-ups", ids.join(",")],
      undefined,
      { file: path.join(w.dir, "take.ork.yaml") },
    );
    return { taking, lines };
  } finally {
    stderr.mockRestore();
    process.exitCode = undefined;
  }
};

const start = async (w: World, ids: readonly string[]) => {
  const out: string[] = [];
  const err: string[] = [];
  const { taking, lines } = prepared(w, ids);
  if (taking === undefined) return { exitCode: 1, runId: "", out, err: lines };
  const { exitCode, result } = await runWorkflowFile({
    file: "take.ork.yaml",
    cwd: w.dir,
    inputs: taking.inputs,
    inPlace: true,
    json: false,
    runtime: () => Promise.resolve(createCliRuntime({ bin: FAKE_CLAUDE })),
    driverChecks: openCodeReady,
    drivers: standInDrivers,
    store: w.store,
    home: w.home,
    human: agreeing,
    ...(taking.runId === undefined ? {} : { runId: taking.runId }),
    out: line => {
      out.push(line);
    },
    err: line => {
      err.push(line);
    },
  });
  return { exitCode, runId: result?.runId ?? "", out, err };
};

describe("ork run --follow-ups", () => {
  it("takes the agent follow-ups as the brief, and marks them taken by the run", async () => {
    const w = world(WITH_BRIEF);
    const retries = await addFollowUp(w, "Add retries");
    const logging = await addFollowUp(w, "Log the failures");
    const ran = await start(w, [retries.id, logging.id.slice(0, 4)]);
    expect(ran.exitCode).toBe(0);
    const taken = w.store.followUps(w.dir);
    expect(taken.map(f => f.takenBy)).toEqual([ran.runId, ran.runId]);
    const events = JSON.stringify(
      w.store.events(ran.runId).map(stored => stored.event),
    );
    expect(events).toContain("Add retries (");
    expect(events).toContain("Log the failures (");
    expect(events).toContain("Files: src/a.ts");
  });

  it("is done when the run publishes", async () => {
    const w = world(WITH_BRIEF);
    const one = await addFollowUp(w, "Add retries");
    const ran = await start(w, [one.id]);
    const recorded = recordPublished(w.store, {
      project: w.dir,
      run: ran.runId,
      ref: "feature",
    });
    expect(recorded.done.map(f => f.status)).toEqual(["done"]);
    expect(w.store.followUp(w.dir, one.id)?.note).toContain(
      "published as feature",
    );
  });

  it("refuses what it can't take, starts nothing, and marks nothing", async () => {
    const w = world(WITH_BRIEF);
    const mine = await addFollowUp(w, "Check the dashboards", {
      for: "me",
      kind: "task",
    });
    const retries = await addFollowUp(w, "Add retries");
    const ran = await start(w, [retries.id, mine.id, "nope"]);
    expect(ran.exitCode).toBe(1);
    expect(ran.err).toEqual([
      "--follow-ups: No follow-up `nope` in this project.",
      `--follow-ups: ${mine.id}: it is for me`,
    ]);
    expect(w.store.runs()).toEqual([]);
    expect(w.store.followUps(w.dir).map(f => f.takenBy)).toEqual([
      undefined,
      undefined,
    ]);
  });

  it("needs a workflow with a brief input, and no --input brief beside it", async () => {
    const w = world(WITHOUT_BRIEF);
    const one = await addFollowUp(w, "Add retries");
    const ran = await start(w, [one.id]);
    expect(ran.exitCode).toBe(1);
    expect(ran.err.join("\n")).toContain("take has none");
    expect(w.store.followUp(w.dir, one.id)?.takenBy).toBeUndefined();
  });
});

const place = (w: World) => ({
  root: w.dir,
  mode: "in-repo" as const,
  dir: path.join(w.dir, ".ork"),
});

describe("a session's follow_up call in a run", () => {
  it("is kept in the run's project, with the worktree it came from", async () => {
    const w = world(WITH_BRIEF);
    const sink = followUpSink({
      store: w.store,
      place: place(w),
      home: w.home,
    });
    const delivered = await sink(
      {
        title: "Tell the partner",
        for: "person:Dana",
        kind: "message",
        due: "after-merge",
        draft: { to: "Dana", text: "The API moved." },
      },
      { node: "write", cwd: w.dir },
    );
    expect(delivered.ok).toBe(true);
    expect(w.store.followUps(w.dir)).toMatchObject([
      { title: "Tell the partner", status: "waiting", place: "store" },
    ]);
  });

  it("refuses an unknown project, naming the registered ones", async () => {
    const w = world(WITH_BRIEF);
    w.store.addProject({
      id: "api",
      root: w.dir,
      mode: "in-repo",
      dir: path.join(w.dir, ".ork"),
    });
    const sink = followUpSink({
      store: w.store,
      place: place(w),
      home: w.home,
    });
    const delivered = await sink(
      { title: "Fix it", for: "project:ghost", kind: "change", due: "now" },
      { node: "write", cwd: w.dir },
    );
    expect(delivered).toEqual({
      ok: false,
      error: "there is no registered project `ghost`; registered: api",
    });
  });
});
