/**
 * @file Tests for the event store: runs and events in SQLite, prefixes and
 *   projects, a reopened file store, the recorder's JSONL copy and masking, the
 *   ownership tree view, and crashed runs.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  createRecorder,
  type EventStore,
  liveStatus,
  maskSecrets,
  openStore,
  type RunEvent,
  type RunRecord,
  type RunResult,
  runTree,
  type SessionUsage,
} from "../src/index.ts";

const usage = (costUsd: number): SessionUsage => ({
  costUsd,
  inputTokens: 100,
  outputTokens: 10,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  turns: 1,
  durationMs: 5,
});

const result = (runId: string, costUsd: number): RunResult => ({
  runId,
  status: "succeeded",
  costUsd,
  nodes: [],
  reasons: [],
  worktrees: [],
});

/** A delegation run: lead owns `check`, which it also spawns as `check-2`. */
const EVENTS: RunEvent[] = [
  {
    type: "run.started",
    runId: "r1",
    workflow: "team",
    entries: ["lead"],
    nodes: [
      { id: "lead", type: "claude.leader" },
      { id: "check", type: "claude.worker", parent: "lead" },
      { id: "ship", type: "tool.shell" },
    ],
  },
  { type: "node.started", id: "lead", nodeType: "claude.leader", round: 1 },
  {
    type: "node.started",
    id: "check",
    nodeType: "claude.worker",
    round: 1,
    owner: "lead",
  },
  {
    type: "node.started",
    id: "check-2",
    nodeType: "claude.worker",
    round: 1,
    owner: "lead",
  },
  {
    type: "node.finished",
    id: "check",
    round: 1,
    ok: true,
    output: { status: "pass", summary: "fine" },
    usage: usage(0.25),
  },
  {
    type: "node.finished",
    id: "check-2",
    round: 1,
    ok: false,
    output: { status: "fail", summary: "broken" },
    usage: usage(0.5),
  },
  { type: "node.skipped", id: "ship" },
];

/** A stand-in record, for lookups that come back empty. */
const RUN: RunRecord = {
  id: "none",
  workflow: "w",
  file: "/w",
  project: "/p",
  status: "succeeded",
  pid: 0,
  startedAt: "",
  costUsd: 0,
};

const seeded = (): EventStore => {
  const store = openStore(":memory:");
  for (const [id, project] of [
    ["abc11111", "/p/one"],
    ["abc22222", "/p/one"],
    ["def33333", "/p/two"],
  ] as const) {
    store.begin({ id, workflow: "w", file: `${project}/w.ork.yaml`, project });
  }
  return store;
};

describe("the event store", () => {
  it("numbers a run's events and settles the run when it finishes", () => {
    const store = seeded();
    const seqs = EVENTS.map(e => store.append("abc11111", e).seq);
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(store.lookup("abc11111")[0]).toMatchObject({
      status: "running",
      costUsd: 0.75,
      pid: process.pid,
    });
    store.append("abc11111", {
      type: "run.finished",
      result: result("abc11111", 0.75),
    });
    expect(store.lookup("abc11111")[0]).toMatchObject({
      status: "succeeded",
      costUsd: 0.75,
    });
    expect(store.events("abc11111", 5).map(e => e.seq)).toEqual([6, 7, 8]);
    expect(store.events("abc11111")[0]?.event).toEqual(EVENTS[0]);
  });

  it("finds runs by prefix and lists them by project, newest first", () => {
    const store = seeded();
    expect(
      store
        .lookup("abc")
        .map(r => r.id)
        .toSorted(),
    ).toEqual(["abc11111", "abc22222"]);
    expect(store.lookup("def").map(r => r.id)).toEqual(["def33333"]);
    expect(store.lookup("zzz")).toEqual([]);
    expect(store.runs({ project: "/p/one" }).map(r => r.id)).toEqual([
      "abc22222",
      "abc11111",
    ]);
    expect(store.runs({ limit: 1 }).map(r => r.id)).toEqual(["def33333"]);
  });

  it("keeps runs in a file across opens, migrating once", () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "ork-db-")), "s.db");
    const first = openStore(file);
    first.begin({ id: "r1", workflow: "w", file: "/w", project: "/p" });
    first.append("r1", {
      type: "node.started",
      id: "a",
      nodeType: "claude.worker",
      round: 1,
    });
    first.close();
    const second = openStore(file);
    expect(second.lookup("r1")[0]?.workflow).toBe("w");
    expect(second.events("r1")).toHaveLength(1);
    second.close();
  });
});

describe("the recorder", () => {
  it("masks secrets and copies every event to the run's JSONL", () => {
    const store = openStore(":memory:");
    const runDir = mkdtempSync(path.join(tmpdir(), "ork-rec-"));
    const record = createRecorder(
      store,
      { id: "r1", workflow: "w", file: "/w", project: "/p" },
      runDir,
    );
    record({
      type: "node.event",
      id: "a",
      event: {
        type: "tool.called",
        id: "t1",
        name: "Bash",
        input: {
          command:
            "curl -H 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123'",
        },
      },
    });
    const lines = readFileSync(path.join(runDir, "events.jsonl"), "utf8")
      .trim()
      .split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("Bearer [masked]");
    expect(JSON.stringify(store.events("r1"))).not.toContain("abcdefghij");
  });

  it("masks common token formats and leaves other text alone", () => {
    expect(
      maskSecrets(
        [
          "key sk-ant-api03-abcdefghijklmnopqrstuvwxyz",
          "gh ghp_abcdefghijklmnopqrstuvwxyz0123",
          "aws AKIAABCDEFGHIJKLMNOP",
          "aws_secret_access_key = wJalrXUtnFEMI/K7MDENG",
          "plain words stay",
        ].join("\n"),
      ).split("\n"),
    ).toEqual([
      "key [masked]",
      "gh [masked]",
      "aws [masked]",
      "aws_secret_access_key = [masked]",
      "plain words stay",
    ]);
  });
});

describe("views over a run", () => {
  it("folds events into the ownership tree, with spawned workers", () => {
    const roots = runTree(EVENTS);
    expect(roots.map(r => r.id)).toEqual(["lead", "ship"]);
    const [lead] = roots;
    expect(
      lead?.children.map(c => [c.id, c.state, c.costUsd, c.template]),
    ).toEqual([
      ["check", "ok", 0.25, undefined],
      ["check-2", "failed", 0.5, "check"],
    ]);
    expect(lead?.state).toBe("running");
    expect(roots[1]?.state).toBe("skipped");
  });

  it("reports a running run whose process is gone as crashed", () => {
    const [run = RUN] = seeded().runs({ project: "/p/two" });
    const gone = spawnSync("true").pid;
    expect(liveStatus(run)).toBe("running");
    expect(liveStatus({ ...run, pid: gone })).toBe("crashed");
  });
});
