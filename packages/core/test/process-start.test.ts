/**
 * @file Tests for telling a run's process from a later one with its id: the
 *   start recorded when a run begins or is resumed, `crashed` when the live
 *   process's start differs, ids that name no process, runs recorded before
 *   starts were, the migration, and reading `/proc` and `ps`.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import {
  liveStatus,
  openStore,
  processAlive,
  type ProcessStartReader,
  processStartOf,
  type RunRecord,
  runProcessAlive,
  runStatus,
  sameStart,
  startFromLstart,
  startFromStat,
} from "../src/index.ts";
import { migrate, MIGRATIONS } from "../src/store/schema.ts";

/** A `running` run of this process, which is alive. */
const RUN: RunRecord = {
  id: "r1",
  workflow: "w",
  file: "/p/w.ork.yaml",
  project: "/p",
  status: "running",
  pid: process.pid,
  startedAt: "2026-11-07T09:00:00.000Z",
  costUsd: 0,
  depth: 0,
};

const reads =
  (start?: string): ProcessStartReader =>
  () =>
    start;

/**
 * This process's start as the system reads it, with another number of ticks or
 * seconds.
 */
const anotherStart = (): string =>
  (processStartOf(process.pid) ?? "ps:0").replace(/\d+$/u, "1");

const NEW_RUN = {
  id: "r1",
  workflow: "w",
  file: "/p/w.ork.yaml",
  project: "/p",
};

/**
 * A store at the schema before process starts, with a running run of this
 * process.
 */
const oldStore = (): string => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "ork-db-")), "s.db");
  const db = new DatabaseSync(file);
  migrate(db, MIGRATIONS.slice(0, 13));
  db.prepare(
    `INSERT INTO runs (id, workflow, file, project, status, pid, started_at)
     VALUES ('r1', 'w', '/p/w.ork.yaml', '/p', 'running', ?, ?)`,
  ).run(process.pid, RUN.startedAt);
  db.close();
  return file;
};

describe("a run's process", () => {
  it("records this process's start when a run begins, and reads as running", () => {
    const store = openStore(":memory:");
    const run = store.begin(NEW_RUN);
    expect(run.processStart).toBe(processStartOf(process.pid));
    expect(store.lookup("r1")[0]?.processStart).toBe(run.processStart);
    expect(liveStatus(run)).toBe("running");
  });

  it("is crashed when the live process with its id started at another time", () => {
    const run = { ...RUN, processStart: "linux:boot:100" };
    expect(liveStatus(run, reads("linux:boot:250"))).toBe("crashed");
    expect(liveStatus(run, reads("linux:other-boot:100"))).toBe("crashed");
    expect(
      liveStatus({ ...RUN, processStart: "ps:100" }, reads("ps:200")),
    ).toBe("crashed");
    expect(runStatus(run, [], reads("linux:boot:250"))).toBe("crashed");
  });

  it("is crashed when the system says this process started at another time", () => {
    const store = openStore(":memory:", { processStart: anotherStart });
    const run = store.begin(NEW_RUN);
    expect(liveStatus(run)).toBe("crashed");
    expect(store.deleteRun("r1")).toBe(true);
  });

  it("is the same process when the start matches, or `ps` is a second out", () => {
    const run = { ...RUN, processStart: "ps:100" };
    expect(liveStatus(run, reads("ps:100"))).toBe("running");
    expect(liveStatus(run, reads("ps:101"))).toBe("running");
    expect(sameStart("linux:b:7", "linux:b:7")).toBe(true);
  });

  it("goes by the id alone when the start can't be read or compared", () => {
    const run = { ...RUN, processStart: "ps:100" };
    expect(liveStatus(run, reads())).toBe("running");
    expect(liveStatus(run, reads("linux:boot:100"))).toBe("running");
    expect(sameStart("ps:100", "linux:boot:100")).toBeUndefined();
  });

  it("is never alive for an id that names no process", () => {
    expect([0, -1, Number.NaN, 1.5].map(pid => processAlive(pid))).toEqual([
      false,
      false,
      false,
      false,
    ]);
    expect(liveStatus({ ...RUN, pid: 0 })).toBe("crashed");
    expect(
      runProcessAlive({ pid: -1, processStart: "ps:1" }, reads("ps:1")),
    ).toBe(false);
  });

  it("goes by the id alone for a run recorded before starts were", () => {
    const run: RunRecord = { ...RUN };
    expect(liveStatus(run, reads("ps:999"))).toBe("running");
    expect(liveStatus({ ...run, pid: 99_999_999 })).toBe("crashed");
  });

  it("migrates an old store, whose runs have no start", () => {
    const store = openStore(oldStore());
    const [run = { ...RUN, id: "missing" }] = store.lookup("r1");
    expect([run.id, run.processStart]).toEqual(["r1", undefined]);
    expect(liveStatus(run)).toBe("running");
    store.close();
  });

  it("records the new process's start when a run is resumed", () => {
    let starts = 0;
    const store = openStore(":memory:", {
      processStart: () => `ps:${String((starts += 1))}`,
    });
    store.begin(NEW_RUN);
    store.append("r1", {
      type: "run.finished",
      result: {
        runId: "r1",
        status: "interrupted",
        costUsd: 0,
        nodes: [],
        reasons: [],
        worktrees: [],
      },
    });
    store.reopen("r1");
    const [run] = store.lookup("r1");
    expect([run?.status, run?.processStart]).toEqual(["running", "ps:2"]);
  });

  it("gives a resumed run of an old store a start", () => {
    const store = openStore(oldStore(), { processStart: () => "ps:5" });
    store.reopen("r1");
    expect(store.lookup("r1")[0]?.processStart).toBe("ps:5");
    store.close();
  });
});

describe("reading a process's start", () => {
  it("reads `/proc/<pid>/stat`'s ticks after the name, which can hold brackets", () => {
    const fields = Array.from({ length: 50 }, (_, i) => String(i + 3));
    const stat = `4242 (a (b) c) ${["S", ...fields.slice(1)].join(" ")}`;
    expect(startFromStat(stat, "boot")).toBe("linux:boot:22");
    expect(startFromStat("4242 (x) S 1", "boot")).toBeUndefined();
  });

  it("reads `ps`'s start, printed in UTC, as seconds", () => {
    expect(startFromLstart("Sat Nov  7 18:07:43 2026   \n")).toBe(
      `ps:${String(Date.UTC(2026, 10, 7, 18, 7, 43) / 1000)}`,
    );
    expect(startFromLstart("")).toBeUndefined();
  });

  it("reads this process's start, and none for a process that is gone", () => {
    expect(processStartOf(process.pid)).toMatch(/^(linux:[^:]*|ps):\d+$/u);
    expect(processStartOf(99_999_999)).toBeUndefined();
  });
});
