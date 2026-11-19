/**
 * @file Tests a benchmark's fresh-session counts: fires, the context at each
 *   delegation, would-fires against the run's threshold or the default, and the
 *   zeros a run from before the rule gives.
 */

import { describe, expect, it } from "vitest";

import { armsMarkdown, rowOf } from "../arms.ts";
import { DEFAULT_OVER, freshSessionsOf } from "../sessions.ts";
import type { Run, StoredEvent } from "../tree.ts";

const run: Run = {
  id: "r1",
  workflow: "build",
  file: "build.ork.yaml",
  parent: null,
  status: "succeeded",
  startedAt: "2026-01-01T00:00:00Z",
  finishedAt: null,
  costUsd: 0,
};

let at = 0;
const event = (type: string, data: Record<string, unknown>): StoredEvent => ({
  run: "r1",
  at: (at += 1),
  type,
  node: typeof data["id"] === "string" ? data["id"] : null,
  data,
});

const started = (extra: Record<string, unknown> = {}) =>
  event("node.started", {
    id: "impl",
    nodeType: "agent.worker",
    round: 1,
    owner: "lead",
    ...extra,
  });

const finished = (contextTokens?: number, kind = "done") =>
  event("node.finished", {
    id: "impl",
    round: 1,
    ok: kind === "done",
    end: { kind },
    ...(contextTokens === undefined ? {} : { usage: { contextTokens } }),
  });

const of = (events: StoredEvent[]) => freshSessionsOf({ runs: [run], events });

describe("fresh sessions", () => {
  it("counts fires and the context at each later delegation", () => {
    const counts = of([
      started(),
      finished(60_000),
      started(),
      finished(130_000),
      started({ fresh: { contextTokens: 130_000, over: 100_000 } }),
      finished(20_000),
    ]);
    expect(counts).toEqual({
      over: 100_000,
      fires: 1,
      would_fires: 1,
      by_node: {
        "build.impl": {
          fires: 1,
          would_fires: 1,
          contexts: [60_000, 130_000],
        },
      },
    });
  });

  it("counts a would-fire where the rule is never, against the default", () => {
    const counts = of([started(), finished(DEFAULT_OVER + 1), started()]);
    expect(counts).toMatchObject({
      over: DEFAULT_OVER,
      fires: 0,
      would_fires: 1,
    });
  });

  it("uses the threshold a fire recorded", () => {
    const counts = of([
      started(),
      finished(60_000),
      started({ fresh: { contextTokens: 60_000, over: 50_000 } }),
      finished(70_000),
      started(),
    ]);
    expect(counts).toMatchObject({ over: 50_000, fires: 1, would_fires: 2 });
  });

  it("skips a start after an end that was not done, or with no owner", () => {
    const counts = of([
      started(),
      finished(200_000, "stopped"),
      started(),
      finished(200_000),
      started({ owner: undefined }),
    ]);
    expect(counts).toMatchObject({ fires: 0, would_fires: 0, by_node: {} });
  });

  it("forgets earlier sessions at a resume", () => {
    const counts = of([
      started(),
      finished(200_000),
      event("run.resumed", { kept: [] }),
      started(),
    ]);
    expect(counts.would_fires).toBe(0);
  });

  it("gives zeros for a run from before the rule", () => {
    const counts = of([started(), finished(), started(), finished()]);
    expect(counts).toEqual({
      over: DEFAULT_OVER,
      fires: 0,
      would_fires: 0,
      by_node: {},
    });
  });

  it("shows fires and would-fires per arm", () => {
    const base = {
      run: "abcd1234",
      status: "succeeded",
      cost_usd: 1,
      minutes: { working: 1 },
      sessions: 2,
    };
    const carried = { turns: { median: 1 }, calls_by_role: {} };
    const on = rowOf(
      "x-t1-on-1",
      { ...base, fresh_sessions: { fires: 2, would_fires: 3 } },
      carried,
    );
    const old = rowOf("x-t1-never-1", base, carried);
    expect([on.fresh, old.fresh]).toEqual([
      { fires: 2, would: 3 },
      { fires: 0, would: 0 },
    ]);
    expect(armsMarkdown([on, old])).toContain("| 2 / 3 |");
  });
});
