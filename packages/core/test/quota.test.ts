/**
 * @file Tests for limits across runs (RFC-007): windows match what `ork usage`
 *   shows, both the user's and a project's caps apply, the ledger is read
 *   across runs, a plan limit holds until it resets, and a run stops as for a
 *   budget; a warning seen more than 3 hours ago is stale and never stops one.
 */

import { parseUserSettings } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import {
  capsOf,
  limitsNow,
  limitsReport,
  openStore,
  type PlanLimit,
  planReason,
  windowOf,
} from "../src/index.ts";

const NOW = new Date(2026, 10, 4, 15, 30);

const spending = (spent: number, plan: PlanLimit[] = []) => ({
  spentSince: () => spent,
  planLimits: () => plan,
});

const rejected = (resetsAt?: string): PlanLimit => ({
  status: "rejected",
  window: "five_hour",
  at: NOW.toISOString(),
  ...(resetsAt === undefined ? {} : { resetsAt }),
});

const HOUR = 60 * 60 * 1000;

/** A seven-day warning seen `ago` ms before `NOW`, resetting in two days. */
const warning = (ago: number): PlanLimit => ({
  status: "allowed_warning",
  window: "seven_day",
  at: new Date(NOW.getTime() - ago).toISOString(),
  resetsAt: new Date(NOW.getTime() + 48 * HOUR).toISOString(),
});

/** The plan limits `limitsReport` shows for `plan`. */
const planShown = (plan: PlanLimit[]) =>
  limitsReport(spending(0, plan), { caps: [], problems: [] }, NOW).plan;

const sessionOf = (id: string, project: string, cost: number) => {
  const store = openStore(":memory:");
  store.begin({ id, workflow: "w", file: `${project}/w.ork.yaml`, project });
  store.append(id, {
    type: "node.event",
    id: "a",
    event: {
      type: "session.finished",
      outcome: {
        subtype: "success",
        sessionId: "s",
        report: null,
        text: "",
        errors: [],
        usage: {
          costUsd: cost,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          turns: 1,
          durationMs: 1,
        },
      },
    },
  });
  return store;
};

describe("windows", () => {
  it("a day runs from midnight to midnight", () => {
    const { since, until } = windowOf("day", NOW);
    expect(since).toEqual(new Date(2026, 10, 4));
    expect(until).toEqual(new Date(2026, 10, 5));
  });

  it("a week starts on Monday, as in ork usage", () => {
    const { since, until } = windowOf("week", NOW);
    expect(since).toEqual(new Date(2026, 10, 2));
    expect(until).toEqual(new Date(2026, 10, 9));
  });

  it("a Sunday belongs to the week before it", () => {
    expect(windowOf("week", new Date(2026, 10, 8)).since).toEqual(
      new Date(2026, 10, 2),
    );
  });

  it("a month runs over into the next year", () => {
    const { since, until } = windowOf("month", new Date(2026, 11, 31));
    expect(since).toEqual(new Date(2026, 11, 1));
    expect(until).toEqual(new Date(2027, 0, 1));
  });
});

describe("caps", () => {
  it("takes the user's and the project's, both", () => {
    expect(capsOf({ dayUsd: 20 }, { dayUsd: 5, monthUsd: 50 }, "/p")).toEqual([
      { window: "day", capUsd: 20 },
      { window: "day", capUsd: 5, project: "/p" },
      { window: "month", capUsd: 50, project: "/p" },
    ]);
  });

  it("has none with none set", () => {
    expect(capsOf(undefined, undefined, "/p")).toEqual([]);
    expect(limitsNow(spending(1000), [], NOW)).toEqual({});
  });

  it("gives what is left of the tightest", () => {
    const caps = capsOf({ dayUsd: 20 }, { dayUsd: 5 }, "/p");
    expect(limitsNow(spending(3), caps, NOW)).toEqual({ leftUsd: 2 });
  });

  it("can't be raised by a project", () => {
    const caps = capsOf({ dayUsd: 5 }, { dayUsd: 500 }, "/p");
    expect(limitsNow(spending(6), caps, NOW).blocked).toContain(
      "your day quota of $5.00 is spent",
    );
  });

  it("says which cap and when it lifts", () => {
    const caps = capsOf(undefined, { weekUsd: 5 }, "/p");
    const { blocked } = limitsNow(spending(5), caps, NOW);
    expect(blocked).toContain("this project's week quota of $5.00 is spent");
    expect(blocked).toContain("it lifts on");
  });

  it("refuses settings it can't read, rather than dropping a cap", () => {
    expect(
      parseUserSettings("schemaVersion: 1\nquotas: { daily: 5 }\n").ok,
    ).toBe(false);
    expect(
      parseUserSettings("schemaVersion: 1\nquotas: { dayUsd: 5 }\n"),
    ).toEqual({
      ok: true,
      settings: { schemaVersion: 1, quotas: { dayUsd: 5 } },
    });
  });
});

describe("plan limits", () => {
  const later = new Date(2026, 10, 4, 18).toISOString();
  const earlier = new Date(2026, 10, 4, 14).toISOString();

  it("hold every run until they reset", () => {
    expect(
      limitsNow(spending(0, [rejected(later)]), [], NOW).blocked,
    ).toContain("five hour limit was reached");
  });

  it("let go once they have reset", () => {
    expect(limitsNow(spending(0, [rejected(earlier)]), [], NOW)).toEqual({});
  });

  it("hold no other run without a time to hold until", () => {
    expect(limitsNow(spending(0, [rejected()]), [], NOW)).toEqual({});
  });

  it("hold other runs only for a limit on the whole account", () => {
    const opus: PlanLimit = { ...rejected(later), window: "seven_day_opus" };
    expect(limitsNow(spending(0, [opus]), [], NOW)).toEqual({});
  });

  it("name the one that lifts last", () => {
    const soon = rejected(later);
    const far: PlanLimit = {
      ...rejected(new Date(2026, 10, 9).toISOString()),
      window: "seven_day",
    };
    expect(limitsNow(spending(0, [soon, far]), [], NOW).blocked).toContain(
      "seven day limit",
    );
  });

  it("stop showing a report with no reset time after a day", () => {
    const old: PlanLimit = {
      status: "allowed_warning",
      window: "plan",
      at: new Date(2026, 10, 2).toISOString(),
    };
    expect(
      limitsReport(spending(0, [old]), { caps: [], problems: [] }, NOW).plan,
    ).toEqual([]);
  });

  it("do not stop on a warning, but are shown", () => {
    const warned: PlanLimit = {
      status: "allowed_warning",
      window: "seven_day",
      at: NOW.toISOString(),
    };
    expect(limitsNow(spending(0, [warned]), [], NOW)).toEqual({});
    expect(
      limitsReport(spending(0, [warned]), { caps: [], problems: [] }, NOW).plan,
    ).toEqual([warned]);
  });

  it("mark a warning seen more than 3 hours ago as stale", () => {
    const old = warning(3 * HOUR + 1);
    expect(planShown([old])).toEqual([{ ...old, stale: true }]);
  });

  it("keep a warning seen 3 hours ago or less fresh", () => {
    const edge = warning(3 * HOUR);
    const recent = warning(HOUR);
    expect(planShown([edge, recent])).toEqual([edge, recent]);
  });

  it("never mark a rejected limit stale", () => {
    const old: PlanLimit = {
      ...rejected(later),
      at: new Date(NOW.getTime() - 2 * 24 * HOUR).toISOString(),
    };
    expect(planShown([old])).toEqual([old]);
  });

  it("do not stop on a stale warning", () => {
    expect(limitsNow(spending(0, [warning(5 * HOUR)]), [], NOW)).toEqual(
      limitsNow(spending(0), [], NOW),
    );
  });

  it("hold every run on a rejected limit whatever its age", () => {
    const old: PlanLimit = {
      ...rejected(later),
      at: new Date(NOW.getTime() - 2 * 24 * HOUR).toISOString(),
    };
    expect(limitsNow(spending(0, [old]), [], NOW).blocked).toContain(
      "five hour limit was reached",
    );
  });

  it("say when a limit has no reset time", () => {
    expect(planReason({ window: "plan" })).toBe(
      "your Claude plan's plan limit was reached",
    );
  });
});

describe("the store", () => {
  it("adds up the ledger, for one project or all", () => {
    const store = sessionOf("r1", "/p", 2);
    const since = new Date(Date.now() - 60_000).toISOString();
    expect(store.spentSince(since)).toBe(2);
    expect(store.spentSince(since, "/p")).toBe(2);
    expect(store.spentSince(since, "/other")).toBe(0);
    expect(store.spentSince(new Date(Date.now() + 60_000).toISOString())).toBe(
      0,
    );
    store.close();
  });

  it("keeps the latest report of each limit, from any run", () => {
    const store = sessionOf("r1", "/p", 1);
    const limit = (status: "allowed" | "rejected") =>
      store.append("r1", {
        type: "node.event",
        id: "a",
        event: {
          type: "plan.limit",
          status,
          window: "five_hour",
          resetsAt: "2030-01-01T00:00:00.000Z",
        },
      });
    limit("rejected");
    expect(store.planLimits()).toMatchObject([
      { status: "rejected", window: "five_hour" },
    ]);
    limit("allowed");
    expect(store.planLimits()).toMatchObject([{ status: "allowed" }]);
    expect(store.clearPlanLimits()).toBe(1);
    expect(store.planLimits()).toEqual([]);
    expect(store.clearPlanLimits()).toBe(0);
    store.close();
  });
});
