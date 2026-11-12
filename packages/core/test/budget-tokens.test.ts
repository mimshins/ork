/**
 * @file Tests for budgets and quotas in tokens (RFC-015): what counts (input,
 *   output and cache writes, never cache reads), a run's `limits.budgetTokens`
 *   with its reserves, `quotas.dayTokens` read from the ledger, and the partial
 *   dollar totals a driver with no dollars leaves.
 */

import type { Driver } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import {
  capsOf,
  countedTokens,
  type EventStore,
  limitsNow,
  limitsReport,
  openStore,
  type SessionUsage,
  usageReport,
} from "../src/index.ts";
import { createReserves } from "../src/run/reserves.ts";
import { createSpend } from "../src/run/spending.ts";
import type { RunEvent } from "../src/run/types.ts";
import type { UsageRow } from "../src/store/usage-types.ts";
import { earlierSpend } from "../src/usage/spend.ts";

const NOW = new Date(2026, 10, 4, 15, 30);

/** 100 input, 20 output, 5 cache-write and 80 cache-read tokens: 125 count. */
const used = (extra: Partial<SessionUsage> = {}): SessionUsage => ({
  costUsd: 0,
  inputTokens: 100,
  outputTokens: 20,
  cacheReadTokens: 80,
  cacheWriteTokens: 5,
  turns: 1,
  durationMs: 1,
  ...extra,
});

const sessionEvents = (driver: Driver, usage: SessionUsage): RunEvent[] => [
  {
    type: "node.event",
    id: "a",
    event: { type: "session.started", sessionId: "s", model: "m", driver },
  },
  {
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
        usage,
      },
    },
  },
];

/** A store with one run whose node ran one session on `driver`. */
const ledgerWith = (driver: Driver): EventStore => {
  const store = openStore(":memory:");
  store.begin({
    id: "r1",
    workflow: "w",
    file: "/p/w.ork.yaml",
    project: "/p",
  });
  store.append("r1", {
    type: "node.started",
    id: "a",
    nodeType: "agent.worker",
    round: 1,
  });
  for (const event of sessionEvents(driver, used())) store.append("r1", event);
  return store;
};

/** A ledger that has used `tokens` today, and no dollars. */
const tokensUsed = (tokens: number) => ({
  spentSince: (_since: string, _project?: string, unit?: "usd" | "tokens") =>
    unit === "tokens" ? tokens : 0,
  planLimits: () => [],
});

/** A ledger row of one session on `driver`. */
const row = (driver: string): UsageRow => ({
  runId: "r1",
  seq: 1,
  at: NOW.toISOString(),
  project: "/p",
  workflow: "w",
  node: "a",
  driver,
  kind: "node",
  round: 1,
  failed: false,
  ...used(),
});

describe("counted tokens", () => {
  it("are input, output and cache writes, never cache reads", () => {
    expect(countedTokens(used())).toBe(125);
    expect(countedTokens(used({ cacheReadTokens: 1_000_000 }))).toBe(125);
  });
});

describe("reserves in tokens", () => {
  it("are kept beside the dollar ones, and a node lets each go on its own", () => {
    const reserves = createReserves();
    reserves.reserve("a", 2, true);
    reserves.reserve("a", 500, true, "tokens");
    expect([reserves.total(), reserves.total("tokens")]).toEqual([2, 500]);
    reserves.reserve("a", 0, true);
    expect([reserves.total(), reserves.total("tokens")]).toEqual([0, 500]);
    reserves.drop("a");
    expect(reserves.total("tokens")).toBe(0);
  });
});

describe("a run's limits.budgetTokens", () => {
  it("sets each session's cap aside, and counts what sessions used", () => {
    const spend = createSpend(undefined, undefined, undefined, 1000);
    spend.reserve("a", 400, true, "tokens");
    expect(spend.tokensLeft()).toBe(600);
    spend.report("a", "s", 0, countedTokens(used()));
    expect(spend.tokensLeft()).toBe(475);
    spend.count(
      "a",
      { ok: true, output: {}, sessionId: "s", usage: used() },
      false,
    );
    spend.settled("a");
    expect(spend.tokensLeft()).toBe(875);
    expect(spend.tokens()).toBe(125);
  });

  it("adds up a session's processes, as each reports its own tokens", () => {
    const spend = createSpend(undefined, undefined, undefined, 1000);
    spend.report("a", "s", 0, 125);
    spend.report("a", "s", 0, 125);
    expect(spend.tokensLeft()).toBe(750);
  });

  it("stops the run once it is spent, whichever budget comes first", () => {
    const spend = createSpend(10, undefined, undefined, 200);
    spend.report("a", "s", 1, 250);
    expect(spend.spentOut()).toEqual({
      status: "budget_exhausted",
      reason: "the run's budget of 200 tokens is spent",
    });
    expect(createSpend(10, undefined, undefined, 200).spentOut()).toBeNull();
  });

  it("starts a resumed run from the tokens it had used, and knows it was partial", () => {
    const events: RunEvent[] = [
      { type: "node.started", id: "a", nodeType: "agent.worker", round: 1 },
      ...sessionEvents("command-code", used()),
      {
        type: "node.finished",
        id: "a",
        round: 1,
        ok: true,
        output: {},
        usage: used(),
      },
    ];
    const earlier = earlierSpend(events);
    expect(earlier).toMatchObject({ tokens: 125, partial: true });
    const spend = createSpend(undefined, earlier, undefined, 1000);
    expect([spend.tokensLeft(), spend.partial()]).toEqual([875, true]);
  });

  it("marks the dollar total partial once a session starts on a driver with no dollars", () => {
    const spend = createSpend(10);
    spend.started("claude-code");
    expect(spend.partial()).toBe(false);
    spend.started("command-code");
    expect(spend.partial()).toBe(true);
  });
});

describe("quotas.dayTokens", () => {
  const caps = capsOf({ dayTokens: 1000 }, { dayTokens: 500 }, "/p");

  it("are read from the user's settings and the project's rules", () => {
    expect(caps).toEqual([
      { window: "day", capTokens: 1000 },
      { window: "day", capTokens: 500, project: "/p" },
    ]);
  });

  it("say what is left, and stop new sessions once the day's tokens reach one", () => {
    expect(limitsNow(tokensUsed(200), caps, NOW)).toEqual({ leftTokens: 300 });
    const { blocked } = limitsNow(tokensUsed(500), caps, NOW);
    expect(blocked).toContain(
      "this project's day quota of 500 tokens is spent",
    );
  });

  it("are shown beside the dollar caps", () => {
    const both = capsOf({ dayUsd: 5, dayTokens: 1000 });
    const report = limitsReport(
      tokensUsed(100),
      { caps: both, problems: [] },
      NOW,
    );
    expect(report.caps).toMatchObject([{ window: "day", capUsd: 5 }]);
    expect(report.tokenCaps).toMatchObject([
      { window: "day", capTokens: 1000, spentTokens: 100, leftTokens: 900 },
    ]);
  });

  it("are summed from the ledger without cache reads", () => {
    const store = ledgerWith("claude-code");
    const since = new Date(Date.now() - 60_000).toISOString();
    expect(store.spentSince(since, undefined, "tokens")).toBe(125);
    expect(store.spentSince(since, "/p", "tokens")).toBe(125);
    expect(store.spentSince(since, "/other", "tokens")).toBe(0);
    store.close();
  });
});

describe("partial dollar totals", () => {
  it("a run's record gives its tokens, and is partial with a session on a driver with no dollars", () => {
    const priced = ledgerWith("claude-code");
    expect(priced.runs()[0]).toMatchObject({ tokens: 125 });
    expect(priced.runs()[0]?.partial).toBeUndefined();
    priced.close();
    const unpriced = ledgerWith("command-code");
    expect(unpriced.lookup("r1")[0]).toMatchObject({
      tokens: 125,
      partial: true,
    });
    unpriced.close();
  });

  it("a usage report's totals give tokens, and are partial with such a session", () => {
    expect(usageReport([row("claude-code")]).totals).toMatchObject({
      tokens: 125,
      partial: false,
    });
    expect(
      usageReport([row("claude-code"), row("command-code")]).totals,
    ).toMatchObject({ tokens: 250, partial: true });
  });
});
