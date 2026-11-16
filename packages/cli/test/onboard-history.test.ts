/**
 * @file Tests for the history digest of a return visit to `ork onboard`: per
 *   workflow how runs ended, what they cost, usage hints, open feedback items
 *   and open follow-ups, from one project's records only, with Ork's built-in
 *   runs left out, and bounded.
 */

import {
  type EventStore,
  type FeedbackReport,
  type FollowUp,
  openStore,
  type RunStatus,
} from "@krapht/ork-core";
import { describe, expect, it } from "vitest";

import {
  EMPTY_HISTORY,
  historyText,
  readHistory,
} from "../src/onboard/history.ts";

const MINE = "/work/mine";
const OTHER = "/work/other";

const begin = (
  store: EventStore,
  id: string,
  workflow: string,
  project: string,
  file = `${project}/.ork/workflows/${workflow}.ork.yaml`,
): void => {
  store.begin({ id, workflow, file, project });
};

const finish = (
  store: EventStore,
  id: string,
  status: RunStatus,
  costUsd = 0,
): void => {
  store.append(id, {
    type: "run.finished",
    result: {
      runId: id,
      status,
      costUsd,
      nodes: [],
      reasons: [],
      worktrees: [],
    },
  });
};

/** One session of `costUsd` that failed, so usage's `failed` hint fires. */
const failedSession = (
  store: EventStore,
  id: string,
  costUsd: number,
): void => {
  store.append(id, {
    type: "node.started",
    id: "build",
    nodeType: "agent.worker",
    round: 1,
  });
  store.append(id, {
    type: "node.event",
    id: "build",
    event: {
      type: "session.started",
      sessionId: "s",
      model: "m",
      driver: "claude-code",
    },
  });
  store.append(id, {
    type: "node.event",
    id: "build",
    event: {
      type: "session.finished",
      outcome: {
        subtype: "error",
        sessionId: "s",
        report: null,
        text: "",
        errors: ["boom"],
        usage: {
          costUsd,
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          turns: 1,
          durationMs: 1,
        },
      },
    },
  });
};

const report = (title: string, severity: FeedbackReport["severity"]) =>
  ({
    source: "agent",
    kind: "friction",
    target: "workflow",
    severity,
    title,
    body: "",
    evidence: [],
    fingerprint: `fp-${title}`,
    origin: {},
  }) satisfies FeedbackReport;

const raise = (
  store: EventStore,
  run: string,
  title: string,
  severity: FeedbackReport["severity"],
): void => {
  store.append(run, {
    type: "feedback.recorded",
    node: "build",
    feedback: report(title, severity),
  });
};

const followUp = (
  project: string,
  id: string,
  patch: Partial<FollowUp>,
): FollowUp => ({
  id,
  project,
  title: id,
  body: "",
  for: "me",
  kind: "task",
  due: "now",
  where: [],
  from: {},
  status: "due",
  place: "store",
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  ...patch,
});

/** Two workflows of this project, and records of another project. */
const seeded = (): EventStore => {
  const store = openStore(":memory:");
  for (const id of ["b1", "b2", "b3"]) begin(store, id, "build", MINE);
  begin(store, "t1", "triage", MINE);
  begin(store, "o1", "build", OTHER);
  begin(
    store,
    "k1",
    "ork-feedback-apply",
    MINE,
    `${MINE}/.ork/runs/.builtin/abc/ork-feedback-apply.ork.yaml`,
  );
  failedSession(store, "b1", 2);
  finish(store, "b1", "failed", 2);
  finish(store, "b2", "succeeded");
  finish(store, "t1", "succeeded");
  finish(store, "o1", "failed");
  finish(store, "k1", "succeeded");
  raise(store, "b1", "Tests flake on CI\nsecond line", "high");
  raise(store, "b2", "Review is slow", "low");
  raise(store, "t1", "Triage misses labels", "medium");
  raise(store, "o1", "Other project's problem", "high");
  store.putFollowUp(
    followUp(MINE, "f-build", { from: { run: "b2", node: "build" } }),
  );
  store.putFollowUp(followUp(MINE, "f-loose", { title: "Loose" }));
  store.putFollowUp(
    followUp(MINE, "f-done", { status: "done", from: { run: "b2" } }),
  );
  store.putFollowUp(followUp(OTHER, "f-other", { from: { run: "o1" } }));
  return store;
};

describe("readHistory", () => {
  it("says how runs ended and what they cost, per workflow, built-ins left out", () => {
    const history = readHistory(seeded(), MINE);
    expect(history.runs).toBe(4);
    expect(history.workflows.map(w => w.workflow)).toEqual(["build", "triage"]);
    const [build] = history.workflows;
    expect(build?.runs).toBe(3);
    expect(build?.ended).toEqual({ failed: 1, succeeded: 1, running: 1 });
    expect(build?.costUsd).toBe(2);
    expect(build?.tokens).toBe(15);
    expect(build?.partial).toBe(false);
  });

  it("carries usage's hints for the workflow", () => {
    const [build, triage] = readHistory(seeded(), MINE).workflows;
    expect(build?.hints.map(h => h.slice(0, 8))).toContain("100% of ");
    expect(triage?.hints).toEqual([]);
  });

  it("lists open feedback items worst first, on one line, of its runs only", () => {
    const [build, triage] = readHistory(seeded(), MINE).workflows;
    expect(build?.feedback.map(f => f.title)).toEqual([
      "Tests flake on CI second line",
      "Review is slow",
    ]);
    expect(triage?.feedback.map(f => f.title)).toEqual([
      "Triage misses labels",
    ]);
  });

  it("leaves a dismissed item out", () => {
    const store = seeded();
    store.setFeedbackStatus("fp-Review is slow", "dismissed");
    const [build] = readHistory(store, MINE).workflows;
    expect(build?.feedback.map(f => f.severity)).toEqual(["high"]);
  });

  it("puts open follow-ups under their run's workflow, the rest apart", () => {
    const history = readHistory(seeded(), MINE);
    const [build] = history.workflows;
    expect(build?.followUps.map(f => f.id)).toEqual(["f-build"]);
    expect(history.followUps.map(f => f.id)).toEqual(["f-loose"]);
  });

  it("leaves another project's runs, items and follow-ups out", () => {
    const text = historyText(readHistory(seeded(), MINE));
    expect(text).not.toContain("Other project");
    expect(text).not.toContain("f-other");
    const theirs = readHistory(seeded(), OTHER);
    expect(theirs.runs).toBe(1);
    expect(theirs.workflows[0]?.feedback.map(f => f.title)).toEqual([
      "Other project's problem",
    ]);
    expect(theirs.followUps).toEqual([]);
  });

  it("is empty with no run of the project's own", () => {
    expect(readHistory(openStore(":memory:"), MINE)).toBe(EMPTY_HISTORY);
    expect(readHistory(seeded(), "/work/nobody")).toBe(EMPTY_HISTORY);
    expect(historyText(EMPTY_HISTORY)).toBe(
      "No runs of this project's workflows yet.",
    );
  });

  it("keeps the most-run workflows and says how many it left out", () => {
    const store = openStore(":memory:");
    for (let n = 0; n < 20; n += 1)
      begin(store, `r${String(n)}`, `w${String(n)}`, MINE);
    const history = readHistory(store, MINE);
    expect(history.workflows).toHaveLength(15);
    expect(history.moreWorkflows).toBe(5);
    expect(historyText(history)).toContain("and 5 more workflows");
  });
});

describe("historyText", () => {
  it("renders each workflow with its endings, hints, items and follow-ups", () => {
    const history = readHistory(seeded(), MINE);
    const lines = historyText(history).split("\n");
    expect(lines[0]).toBe("4 runs of this project's workflows.");
    expect(lines).toContain(
      `build: 3 runs (1 succeeded, 1 failed, 1 running); $2.00, 15 tokens; last ${String(history.workflows[0]?.lastRunAt)}`,
    );
    expect(lines).toContain(
      "  feedback fp-Tests fla (high friction, 1×): Tests flake on CI second line",
    );
    expect(lines).toContain(
      "  follow-up f-build (due, task for me, due now): f-build",
    );
    expect(lines).toContain("Open follow-ups from no run here:");
  });
});
