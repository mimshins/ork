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
  type GhRunner,
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
  patch: {
    for?: "agent" | "me";
    kind?: "change" | "task";
    due?: "now" | "after-merge";
    ref?: string;
  } = {},
): Promise<FollowUp> =>
  (
    await followUpStore({ rows: w.store, project: w.dir, home: w.home }).add({
      title,
      body: `${title}: the details`,
      for: patch.for ?? "agent",
      kind: patch.kind ?? "change",
      due: patch.due ?? "now",
      ...(patch.ref === undefined ? {} : { ref: patch.ref }),
      where: ["src/a.ts"],
    })
  ).followUp;

/** A `gh` that can't be reached. */
const BROKEN_GH: GhRunner = () =>
  Promise.resolve({ ok: false, stdout: "", stderr: "gh: rate limited" });

/** What `ork run take.ork.yaml <args>` printed to stderr, and its exit code. */
const preparedWith = async (
  w: World,
  args: readonly string[],
  gh?: GhRunner,
) => {
  const lines: string[] = [];
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(text => {
    lines.push(String(text).trimEnd());
    return true;
  });
  try {
    const taking = await prepareFollowUps(
      w.store,
      args,
      undefined,
      { file: path.join(w.dir, "take.ork.yaml") },
      gh,
    );
    return { taking, lines, exitCode: process.exitCode };
  } finally {
    stderr.mockRestore();
    process.exitCode = undefined;
  }
};

/** What `ork run take.ork.yaml --follow-ups <ids>` printed to stderr. */
const prepared = (w: World, ids: readonly string[], gh?: GhRunner) =>
  preparedWith(w, ["--follow-ups", ids.join(",")], gh);

const start = async (w: World, ids: readonly string[], gh?: GhRunner) => {
  const out: string[] = [];
  const err: string[] = [];
  const { taking, lines } = await prepared(w, ids, gh);
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

/** A run another process is going through: live, as this process is. */
const beginLive = (w: World, id: string): void => {
  w.store.begin({
    id,
    workflow: "take",
    file: "take.ork.yaml",
    project: w.dir,
  });
};

/** Marks `f` taken by a run, as an earlier `--follow-ups` would have. */
const takenBy = (w: World, f: FollowUp, run: string): void => {
  w.store.putFollowUp({ ...f, takenBy: run });
};

describe("a follow-up a live run already took", () => {
  it("is skipped by `due`, with a line saying so, and the rest taken", async () => {
    const w = world(WITH_BRIEF);
    const held = await addFollowUp(w, "Add retries");
    const free = await addFollowUp(w, "Log the failures");
    beginLive(w, "first1");
    takenBy(w, held, "first1");
    const { taking, lines } = await prepared(w, ["due"]);
    expect(taking?.inputs.join("\n")).not.toContain("Add retries");
    expect(lines).toEqual([
      `--follow-ups due: skipped ${held.id}, taken by run first1, still running.`,
    ]);
    expect(w.store.followUp(w.dir, free.id)?.takenBy).toBe(taking?.runId);
    expect(w.store.followUp(w.dir, held.id)?.takenBy).toBe("first1");
  });

  it("fails `due` with the reason when that leaves nothing", async () => {
    const w = world(WITH_BRIEF);
    const held = await addFollowUp(w, "Add retries");
    beginLive(w, "first1");
    takenBy(w, held, "first1");
    const { taking, lines, exitCode } = await prepared(w, ["due"]);
    expect(taking).toBeUndefined();
    expect(exitCode).toBe(1);
    expect(lines.at(-1)).toBe(
      "--follow-ups due: no agent follow-ups are due. 1 due one is taken by a run still running. `ork follow-ups list` shows them.",
    );
  });

  it("is refused by id, and can be taken again once that run ended", async () => {
    const w = world(WITH_BRIEF);
    const one = await addFollowUp(w, "Add retries");
    beginLive(w, "first1");
    takenBy(w, one, "first1");
    const refused = await prepared(w, [one.id]);
    expect(refused.taking).toBeUndefined();
    expect(refused.lines).toEqual([
      `--follow-ups: ${one.id}: taken by run first1, still running`,
    ]);
    w.store.append("first1", {
      type: "run.finished",
      result: {
        runId: "first1",
        status: "failed",
        costUsd: 0,
        nodes: [],
        reasons: [],
        worktrees: [],
      },
    });
    const again = await prepared(w, [one.id]);
    expect(again.taking).toBeDefined();
    expect(w.store.followUp(w.dir, one.id)?.takenBy).toBe(again.taking?.runId);
  });

  it("is only checked, not marked, when the caller marks later (--detach)", async () => {
    const w = world(WITH_BRIEF);
    const one = await addFollowUp(w, "Add retries");
    const taking = await prepareFollowUps(
      w.store,
      ["--follow-ups", one.id],
      undefined,
      { file: path.join(w.dir, "take.ork.yaml") },
      undefined,
      false,
    );
    expect(taking).toBeDefined();
    expect(w.store.followUp(w.dir, one.id)?.takenBy).toBeUndefined();
  });
});

/** Makes the mark on a follow-up look `minutes` old. */
const markedMinutesAgo = (w: World, id: string, minutes: number): void => {
  const f = w.store.followUp(w.dir, id);
  if (f === undefined) return;
  const updatedAt = new Date(Date.now() - minutes * 60_000).toISOString();
  w.store.putFollowUp({ ...f, updatedAt });
};

describe("a follow-up marked by a run the store does not know yet", () => {
  it("is skipped by a second `due` for two minutes, then free again", async () => {
    const w = world(WITH_BRIEF);
    const one = await addFollowUp(w, "Add retries");
    // The first run marks it, and has not been recorded (no `store.begin`).
    const first = await prepared(w, ["due"]);
    expect(first.taking?.runId).toBeDefined();
    const second = await prepared(w, ["due"]);
    expect(second.taking).toBeUndefined();
    expect(second.lines[0]).toBe(
      `--follow-ups due: skipped ${one.id}, taken by run ${first.taking?.runId}, not started yet; free in under 2 minutes.`,
    );
    expect(w.store.followUp(w.dir, one.id)?.takenBy).toBe(first.taking?.runId);
    markedMinutesAgo(w, one.id, 3);
    const third = await prepared(w, ["due"]);
    expect(third.taking).toBeDefined();
    expect(w.store.followUp(w.dir, one.id)?.takenBy).toBe(third.taking?.runId);
  });

  it("is refused by id for the same two minutes", async () => {
    const w = world(WITH_BRIEF);
    const one = await addFollowUp(w, "Add retries");
    const first = await prepared(w, [one.id]);
    const again = await prepared(w, [one.id]);
    expect(again.lines).toEqual([
      `--follow-ups: ${one.id}: taken by run ${first.taking?.runId}, not started yet; free in under 2 minutes`,
    ]);
  });
});

const NEEDS =
  "--follow-ups needs follow-up ids, or `due` for every due agent follow-up. `ork follow-ups list` shows them.";

/** The ids of the follow-ups a run took, in the store's order. */
const takenIds = (w: World): string[] =>
  w.store
    .followUps(w.dir)
    .filter(f => f.takenBy !== undefined)
    .map(f => f.id)
    .toSorted();

describe("ork run --follow-ups due", () => {
  it("takes every due agent follow-up, and not a waiting or a `me` one", async () => {
    const w = world(WITH_BRIEF);
    const one = await addFollowUp(w, "Add retries");
    const two = await addFollowUp(w, "Log the failures");
    await addFollowUp(w, "Wait for the merge", {
      due: "after-merge",
      ref: "feature",
    });
    await addFollowUp(w, "Check the dashboards", { for: "me", kind: "task" });
    const ran = await start(w, ["due"], BROKEN_GH);
    expect(ran.exitCode).toBe(0);
    expect(takenIds(w)).toEqual([one.id, two.id].toSorted());
  });

  it("takes the union with ids, each once", async () => {
    const w = world(WITH_BRIEF);
    const one = await addFollowUp(w, "Add retries");
    const two = await addFollowUp(w, "Log the failures");
    const { taking } = await prepared(w, ["due", one.id.slice(0, 4)]);
    expect(taking?.inputs.join("\n").match(/^## /gmu)).toHaveLength(2);
    expect(takenIds(w)).toEqual([one.id, two.id].toSorted());
  });

  it("warns when gh can't check pull requests, and still takes what is due", async () => {
    const w = world(WITH_BRIEF);
    const one = await addFollowUp(w, "Add retries");
    await addFollowUp(w, "Wait for the merge", {
      due: "after-merge",
      ref: "feature",
    });
    const { taking, lines } = await prepared(w, ["due"], BROKEN_GH);
    expect(taking).toBeDefined();
    expect(lines).toEqual([
      "Can't check PRs: gh failed: gh: rate limited. After-merge follow-ups stay waiting.",
    ]);
    expect(takenIds(w)).toEqual([one.id]);
  });

  it("exits 1 and takes nothing when none is due", async () => {
    const w = world(WITH_BRIEF);
    await addFollowUp(w, "Check the dashboards", { for: "me", kind: "task" });
    const { taking, lines, exitCode } = await prepared(w, ["due"]);
    expect(taking).toBeUndefined();
    expect(exitCode).toBe(1);
    expect(lines).toEqual([
      "--follow-ups due: no agent follow-ups are due. `ork follow-ups list` shows them.",
    ]);
    expect(takenIds(w)).toEqual([]);
    expect(w.store.runs()).toEqual([]);
  });

  it("is refused beside --input brief=, as ids are", async () => {
    const w = world(WITH_BRIEF);
    await addFollowUp(w, "Add retries");
    const { taking, lines, exitCode } = await preparedWith(w, [
      "--follow-ups",
      "due",
      "--input",
      "brief=mine",
    ]);
    expect(taking).toBeUndefined();
    expect(exitCode).toBe(1);
    expect(lines).toEqual([
      "--follow-ups and --input brief=… both set the brief.",
    ]);
    expect(takenIds(w)).toEqual([]);
  });
});

describe("ork run --follow-ups with nothing after it", () => {
  const empties: [string, string[]][] = [
    ["no value", ["--follow-ups"]],
    ["an empty value", ["--follow-ups", ""]],
    ["an empty =value", ["--follow-ups="]],
    ["a flag next", ["--follow-ups", "--input", "brief=x"]],
  ];
  it.each(empties)("says what it needs for %s", async (_, args) => {
    const w = world(WITH_BRIEF);
    await addFollowUp(w, "Add retries");
    const { taking, lines, exitCode } = await preparedWith(w, args);
    expect(taking).toBeUndefined();
    expect(exitCode).toBe(1);
    expect(lines).toEqual([NEEDS]);
    expect(takenIds(w)).toEqual([]);
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
