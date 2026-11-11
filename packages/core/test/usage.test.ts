/**
 * @file Tests for the usage ledger and reports: a session's spend reaches the
 *   ledger as its event is written, a called run is not counted twice, `ork
 *   chat` is counted, older stores are filled in when they migrate, moved
 *   projects keep their rows, and reports add up with hints from thresholds.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import {
  type EventStore,
  type NodeResult,
  openStore,
  type RunEvent,
  type SessionUsage,
  type UsageRow,
  usageReport,
  usageRowsOf,
} from "../src/index.ts";
import { createSpend, withOwnSpend } from "../src/run/spending.ts";
import { migrate, MIGRATIONS } from "../src/store/schema.ts";
import { earlierSpend } from "../src/usage/spend.ts";

const spend = (costUsd: number, extra: Partial<SessionUsage> = {}) => ({
  costUsd,
  inputTokens: 10,
  outputTokens: 5,
  cacheReadTokens: 30,
  cacheWriteTokens: 0,
  turns: 2,
  durationMs: 1000,
  ...extra,
});

const started = (id: string, model = "sonnet"): RunEvent => ({
  type: "node.event",
  id,
  event: {
    type: "session.started",
    sessionId: `s-${id}`,
    model,
    driver: "claude-code",
  },
});

const finished = (
  id: string,
  usage: SessionUsage,
  options: { subtype?: string; fail?: boolean } = {},
): RunEvent => ({
  type: "node.event",
  id,
  event: {
    type: "session.finished",
    outcome: {
      subtype: options.subtype ?? "success",
      sessionId: `s-${id}`,
      report: {
        status: options.fail === true ? "fail" : "pass",
        summary: "",
        artifacts: {},
        fields: {},
      },
      text: "",
      usage,
      errors: [],
    },
  },
});

const session = (
  id: string,
  round: number,
  usage: SessionUsage,
  model = "sonnet",
): RunEvent[] => [
  { type: "node.started", id, nodeType: "agent.worker", round },
  started(id, model),
  finished(id, usage),
  { type: "node.finished", id, round, ok: true, output: {}, usage },
];

const RUN_STARTED: RunEvent = {
  type: "run.started",
  runId: "r1",
  workflow: "w",
  entries: ["build"],
  nodes: [
    { id: "build", type: "agent.worker" },
    { id: "call", type: "workflow.call" },
  ],
};

const begun = (id = "r1", project = "/p/one", workflow = "w"): EventStore => {
  const store = openStore(":memory:");
  store.begin({ id, workflow, file: `${project}/w.ork.yaml`, project });
  return store;
};

/** The store as it was before the ledger. */
const applyOldMigrations = (db: DatabaseSync): void => {
  for (const migration of MIGRATIONS.slice(0, 7)) {
    if (typeof migration === "string") db.exec(migration);
  }
};

const row = (extra: Partial<UsageRow>): UsageRow => ({
  runId: "r1",
  seq: 1,
  at: new Date(2026, 10, 3, 12).toISOString(),
  project: "/p/one",
  workflow: "w",
  node: "build",
  kind: "node",
  round: 1,
  failed: false,
  ...spend(1),
  ...extra,
});

describe("the usage ledger", () => {
  it("records a session as its event is written, with its model and driver", () => {
    const store = begun();
    store.append("r1", RUN_STARTED);
    for (const event of session("build", 1, spend(0.5))) {
      store.append("r1", event);
    }
    expect(store.usage()).toMatchObject([
      {
        runId: "r1",
        project: "/p/one",
        workflow: "w",
        node: "build",
        model: "sonnet",
        driver: "claude-code",
        kind: "node",
        round: 1,
        failed: false,
        costUsd: 0.5,
        cacheReadTokens: 30,
      },
    ]);
  });

  it("leaves a workflow.call node's usage to the run it called", () => {
    const store = begun();
    store.append("r1", RUN_STARTED);
    store.append("r1", {
      type: "node.started",
      id: "call",
      nodeType: "workflow.call",
      round: 1,
    });
    store.append("r1", {
      type: "node.finished",
      id: "call",
      round: 1,
      ok: true,
      output: {},
      usage: spend(9),
    });
    expect(store.usage()).toEqual([]);
  });

  it("counts a session `ork chat` resumes after the node finished", () => {
    const store = begun();
    store.append("r1", RUN_STARTED);
    for (const event of session("build", 1, spend(1))) {
      store.append("r1", event);
    }
    store.append("r1", started("build"));
    store.append("r1", finished("build", spend(1.25)));
    expect(store.usage().map(r => [r.kind, r.costUsd])).toEqual([
      ["node", 1],
      ["chat", 0.25],
    ]);
  });

  it("counts only the rest of a session resumed under its own id", () => {
    const store = begun();
    store.append("r1", RUN_STARTED);
    for (const event of session("build", 1, spend(1))) {
      store.append("r1", event);
    }
    store.append("r1", started("build"));
    store.append("r1", finished("build", spend(1.25, { inputTokens: 7 })));
    expect(store.usage().map(r => [r.costUsd, r.inputTokens])).toEqual([
      [1, 10],
      [0.25, 7],
    ]);
  });

  it("marks a failed session, a later round and a spawned worker's template", () => {
    const events: RunEvent[] = [
      RUN_STARTED,
      {
        type: "node.started",
        id: "build-1",
        nodeType: "agent.worker",
        round: 2,
      },
      started("build-1"),
      finished("build-1", spend(1), { fail: true }),
    ];
    const rows = usageRowsOf(
      { id: "r1", project: "/p", workflow: "w" },
      events.map((event, index) => ({
        seq: index + 1,
        at: "2026-11-03T00:00:00.000Z",
        event,
      })),
    );
    expect(rows).toMatchObject([
      { node: "build-1", template: "build", round: 2, failed: true },
    ]);
  });

  it("marks a fanned node's item with its node as the template", () => {
    const events: RunEvent[] = [
      RUN_STARTED,
      {
        type: "node.started",
        id: "build.2",
        nodeType: "agent.worker",
        round: 1,
      },
      started("build.2"),
      finished("build.2", spend(1)),
    ];
    const rows = usageRowsOf(
      { id: "r1", project: "/p", workflow: "w" },
      events.map((event, index) => ({
        seq: index + 1,
        at: "2026-11-03T00:00:00.000Z",
        event,
      })),
    );
    expect(rows).toMatchObject([{ node: "build.2", template: "build" }]);
  });

  it("filters by project, workflow and time, `until` excluded", () => {
    const store = begun();
    store.begin({
      id: "r2",
      workflow: "x",
      file: "/p/two/x",
      project: "/p/two",
    });
    store.append("r1", started("build"));
    store.append("r1", finished("build", spend(1)));
    store.append("r2", started("a"));
    store.append("r2", finished("a", spend(2)));
    expect(store.usage({ project: "/p/two" }).map(r => r.runId)).toEqual([
      "r2",
    ]);
    expect(store.usage({ workflow: "w" }).map(r => r.runId)).toEqual(["r1"]);
    const at = String(store.usage({ workflow: "x" })[0]?.at);
    expect(store.usage({ until: at, workflow: "x" })).toEqual([]);
    expect(store.usage({ since: at, workflow: "x" })).toHaveLength(1);
  });

  it("follows a project that moved", () => {
    const store = begun("r1", "/p/one");
    store.addProject({
      id: "one",
      root: "/p/one",
      mode: "in-repo",
      dir: "/p/one/.ork",
    });
    store.append("r1", started("build"));
    store.append("r1", finished("build", spend(1)));
    store.moveProject("one", {
      root: "/p/new",
      mode: "in-repo",
      dir: "/p/new/.ork",
    });
    expect(store.usage({ project: "/p/new" })).toHaveLength(1);
  });

  it("fills itself from the runs recorded before it existed, and keeps feedback", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ork-usage-"));
    const file = path.join(dir, "state.db");
    try {
      const db = new DatabaseSync(file);
      applyOldMigrations(db);
      db.exec("PRAGMA user_version = 7");
      db.exec(`INSERT INTO runs (id, workflow, file, project, status, pid, started_at)
        VALUES ('old', 'w', '/p/w', '/p', 'succeeded', 0, '2026-01-01T00:00:00.000Z')`);
      db.exec(`INSERT INTO feedback (run_id, seq, at, source, kind, target, severity,
          title, body, evidence, fingerprint, feedback_version)
        VALUES ('old', 3, '2026-01-01', 'agent', 'bug', 'ork', 'low', 't', 'b', '[]', 'fp', 1)`);
      const insert = db.prepare(
        "INSERT INTO events (run_id, seq, at, type, node, data) VALUES ('old', ?, '2026-01-01T00:00:00.000Z', ?, ?, ?)",
      );
      for (const [index, event] of session("build", 1, spend(0.5)).entries()) {
        insert.run(index + 1, event.type, "build", JSON.stringify(event));
      }
      db.close();
      const store = openStore(file);
      expect(store.usage()).toMatchObject([
        { runId: "old", costUsd: 0.5, seq: 3 },
      ]);
      store.deleteRun("old");
      expect(store.usage()).toHaveLength(1);
      expect(store.feedbackRecords("fp")).toHaveLength(1);
      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("usage reports", () => {
  it("adds up by run and session, and reads the cache rate from all input", () => {
    const { totals } = usageReport([
      row({ runId: "a" }),
      row({ runId: "a", seq: 2 }),
      row({ runId: "b" }),
    ]);
    expect(totals).toMatchObject({
      costUsd: 3,
      runs: 2,
      sessions: 3,
      inputTokens: 30,
      cacheHitRate: 0.75,
    });
  });

  it("is empty with no rows", () => {
    const report = usageReport([]);
    expect(report.totals).toMatchObject({ costUsd: 0, cacheHitRate: 0 });
    expect(report.groups.day).toEqual([]);
    expect(report.hints).toEqual([]);
  });

  it("buckets time oldest first in the local day, and the rest by cost", () => {
    const report = usageReport([
      row({
        at: new Date(2026, 10, 3, 23).toISOString(),
        costUsd: 1,
        workflow: "small",
      }),
      row({
        at: new Date(2026, 10, 2, 1).toISOString(),
        costUsd: 4,
        workflow: "big",
      }),
      row({
        at: new Date(2026, 9, 31, 9).toISOString(),
        costUsd: 2,
        workflow: "mid",
      }),
    ]);
    expect(report.groups.day.map(g => g.key)).toEqual([
      "2026-10-31",
      "2026-11-02",
      "2026-11-03",
    ]);
    expect(report.groups.week.map(g => [g.key, g.costUsd])).toEqual([
      ["2026-10-26", 2],
      ["2026-11-02", 5],
    ]);
    expect(report.groups.month.map(g => g.key)).toEqual(["2026-10", "2026-11"]);
    expect(report.groups.workflow.map(g => g.key)).toEqual([
      "big",
      "mid",
      "small",
    ]);
  });

  it("groups a spawned worker's and an item's sessions under its template", () => {
    const report = usageReport([
      row({ node: "build-1", template: "build" }),
      row({ node: "build-2", template: "build", seq: 2 }),
      row({ node: "build.0", template: "build", seq: 3 }),
    ]);
    expect(report.groups.node.map(g => [g.key, g.sessions])).toEqual([
      ["w/build", 3],
    ]);
  });

  it("counts rework and failures, and chat apart from rework", () => {
    const { totals } = usageReport([
      row({ costUsd: 1 }),
      row({ costUsd: 2, round: 2 }),
      row({ costUsd: 4, failed: true }),
      row({ costUsd: 8, kind: "chat", round: 2 }),
    ]);
    expect(totals).toMatchObject({ reworkUsd: 2, failedUsd: 4, chatUsd: 8 });
  });

  it("gives no hints on a small spend", () => {
    expect(usageReport([row({ costUsd: 0.1, failed: true })]).hints).toEqual(
      [],
    );
  });

  it("points at rework, failures, one costly node and a cold cache", () => {
    const report = usageReport([
      row({
        costUsd: 6,
        round: 3,
        node: "big",
        cacheReadTokens: 0,
        inputTokens: 200_000,
      }),
      row({ costUsd: 3, failed: true, node: "small", cacheReadTokens: 0 }),
      row({ costUsd: 1, node: "other", cacheReadTokens: 0 }),
    ]);
    expect(report.hints.map(h => h.code)).toEqual([
      "rework",
      "failed",
      "concentrated",
      "cache",
    ]);
    expect(report.hints[2]?.message).toContain("w/big took 60%");
  });

  it("does not call one node concentrated when it is the only one", () => {
    expect(
      usageReport([row({ costUsd: 5 })]).hints.map(h => h.code),
    ).not.toContain("concentrated");
  });
});

const result = (sessionId: string, costUsd: number): NodeResult => ({
  ok: true,
  output: { usage: spend(costUsd) },
  usage: spend(costUsd),
  sessionId,
});

/** A session of `id` reporting `cost` as its total. */
const sessionFinished = (id: string, sessionId: string, cost: number) => {
  const event = finished(id, spend(cost));
  return event.type === "node.event" && event.event.type === "session.finished"
    ? {
        ...event,
        event: {
          ...event.event,
          outcome: { ...event.event.outcome, sessionId },
        },
      }
    : event;
};

/** The same session event, as a leader's fork's (ADR-063). */
const forkOf = (event: RunEvent): RunEvent =>
  event.type === "node.event"
    ? { ...event, event: { ...event.event, fork: true } }
    : event;

/** What a run has spent after one session reported these totals. */
const spentAfter = (totals: readonly number[]): number => {
  const counter = createSpend(100);
  for (const total of totals) counter.count("n", result("s", total), false);
  return counter.total();
};

/** The ledger's rows for one session reporting these totals. */
const rowsOfReports = (totals: readonly number[]): UsageRow[] =>
  usageRowsOf(
    { id: "r", project: "/p", workflow: "w" },
    totals.map((total, index) => ({
      seq: index + 1,
      at: "2026-01-01T00:00:00.000Z",
      event: sessionFinished("n", "s", total),
    })),
  );

describe("a result's own spend", () => {
  it("takes off what the session had reported, in usage and in output", () => {
    const totals = new Map<string, number>();
    expect(withOwnSpend("n", result("s", 1), totals).usage?.costUsd).toBe(1);
    const later = withOwnSpend("n", result("s", 1.5), totals);
    expect(later.usage?.costUsd).toBe(0.5);
    expect(later.output["usage"]).toMatchObject({ costUsd: 0.5 });
  });

  it("keeps a separate total per session and per node", () => {
    const totals = new Map<string, number>();
    withOwnSpend("n", result("a", 1), totals);
    expect(withOwnSpend("n", result("b", 2), totals).usage?.costUsd).toBe(2);
    expect(withOwnSpend("m", result("a", 2), totals).usage?.costUsd).toBe(2);
  });

  it("leaves a result with no session alone", () => {
    const plain: NodeResult = { ok: true, output: {} };
    expect(withOwnSpend("n", plain, new Map())).toBe(plain);
  });

  it("ignores a crash's zero, and counts a lower total as a new start", () => {
    expect(spentAfter([5, 0, 5.2])).toBeCloseTo(5.2);
    expect(spentAfter([5, 0.3])).toBeCloseTo(5.3);
    expect(spentAfter([5, 0.3, 0.5])).toBeCloseTo(5.5);
  });

  it("gives the ledger the same answers", () => {
    const costs = rowsOfReports([5, 0, 5.2]).map(r => r.costUsd);
    expect(costs[0]).toBe(5);
    expect(costs[1]).toBe(0);
    expect(costs[2]).toBeCloseTo(0.2);
  });
});

describe("running sessions against the budget", () => {
  it("counts each running session of a node until the node settles", () => {
    const counter = createSpend(10);
    counter.report("n", "a", 3);
    counter.report("n", "b", 4);
    counter.report("m", "a", 1);
    expect(counter.budgetLeft()).toBe(2);
    counter.settled("n");
    expect(counter.budgetLeft()).toBe(9);
  });
});

describe("what a resumed run starts from", () => {
  const cut: RunEvent[] = [
    { type: "node.started", id: "n", nodeType: "agent.leader", round: 1 },
    sessionFinished("n", "s", 3),
    {
      type: "node.finished",
      id: "n",
      round: 1,
      ok: false,
      output: {},
      usage: spend(3),
    },
  ];

  it("counts a session cut off after it reported once", () => {
    const earlier = earlierSpend(cut);
    expect(earlier.total).toBe(3);
    const counter = createSpend(10, earlier);
    const own = counter.count("n", result("s", 5), false);
    expect(own.usage?.costUsd).toBe(2);
    expect(counter.total()).toBe(5);
  });

  it("lets a session cut off before its node finished count that part", () => {
    const earlier = earlierSpend(cut.slice(0, 2));
    expect(earlier.total).toBe(0);
    const counter = createSpend(10, earlier);
    expect(counter.count("n", result("s", 5), false).usage?.costUsd).toBe(5);
  });

  it("leaves `ork chat`'s spend out of the node's next result", () => {
    const earlier = earlierSpend([...cut, sessionFinished("n", "s", 4)]);
    const own = createSpend(10, earlier).count("n", result("s", 5), false);
    expect(own.usage?.costUsd).toBe(1);
  });

  it("does not count a replayed result again", () => {
    const counter = createSpend(10, { total: 3, reported: new Map() });
    const stored = result("s", 3);
    expect(counter.count("n", stored, true)).toBe(stored);
    expect(counter.total()).toBe(3);
  });

  it("keeps a fork's spend, whether or not the leader it forked finished", () => {
    const forked = forkOf(sessionFinished("n", "fork-1", 0.5));
    const cutOff = earlierSpend([...cut.slice(0, 2), forked]);
    expect(cutOff.total).toBe(0.5);
    expect(cutOff.forks).toEqual(new Map([["n", 0.5]]));
    // The leader's own session, cut off, still counts its whole next total.
    const counter = createSpend(10, cutOff);
    expect(counter.count("n", result("s", 5), false).usage?.costUsd).toBe(5);
    expect(counter.total()).toBe(5.5);

    const after = earlierSpend([...cut.slice(0, 2), forked, ...cut.slice(2)]);
    expect(after.total).toBe(3.5);
  });

  it("is what a run's budget goes on from", () => {
    const counter = createSpend(4, earlierSpend(cut));
    expect(counter.left()).toBe(1);
    expect(counter.spentOut()).toBeNull();
  });
});

describe("a declared node's name", () => {
  it("is not read as a spawned worker of another declared node", () => {
    const [only] = usageRowsOf({ id: "r", project: "/p", workflow: "w" }, [
      {
        seq: 1,
        at: "2026-01-01T00:00:00.000Z",
        event: {
          type: "run.started",
          runId: "r",
          workflow: "w",
          entries: ["build"],
          nodes: [
            { id: "build", type: "agent.worker" },
            { id: "build-2", type: "agent.worker" },
          ],
        },
      },
      {
        seq: 2,
        at: "2026-01-01T00:00:00.000Z",
        event: sessionFinished("build-2", "s", 1),
      },
    ]);
    expect(only?.template).toBeUndefined();
  });
});

describe("migrating the store", () => {
  it("leaves nothing of a step that fails, and its version as it was", () => {
    const db = new DatabaseSync(":memory:");
    expect(() => {
      migrate(db, ["CREATE TABLE a (x)", "CREATE TABLE b (x); NOT SQL"]);
    }).toThrow(/syntax error/u);
    expect(db.prepare("PRAGMA user_version").get()?.["user_version"]).toBe(1);
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE name = 'b'").all(),
    ).toEqual([]);
    db.close();
  });
});

describe("writing an event and its ledger row", () => {
  it("writes neither when the ledger cannot be written", () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "ork-tx-")), "s.db");
    const store = openStore(file);
    store.begin({ id: "r", workflow: "w", file: "/p/w", project: "/p" });
    const db = new DatabaseSync(file);
    db.exec(
      "CREATE TRIGGER no_usage BEFORE INSERT ON usage BEGIN SELECT RAISE(ABORT, 'no'); END",
    );
    db.close();
    expect(() => store.append("r", sessionFinished("n", "s", 1))).toThrow(
      /no/u,
    );
    expect(store.events("r")).toEqual([]);
    store.close();
    rmSync(path.dirname(file), { recursive: true, force: true });
  });
});
