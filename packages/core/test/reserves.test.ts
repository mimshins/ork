/**
 * @file Tests for the reserves running sessions hold against a run's budget
 *   (ADR-077): what they take out of what is offered, when they let it go, who
 *   waits on them, and that they never end a run.
 */

import { describe, expect, it } from "vitest";

import { createReserves } from "../src/run/reserves.ts";
import { createSpend } from "../src/run/spending.ts";

const never = new AbortController().signal;

/** Whether `promise` has settled after the queued callbacks ran. */
const settledYet = (promise: Promise<unknown>): Promise<boolean> =>
  Promise.race([
    promise.then(() => true),
    new Promise<boolean>(resolve => {
      setImmediate(() => {
        resolve(false);
      });
    }),
  ]);

/** Shrinks `w`'s reserve to `to`, or drops it with no `to`. */
const freeTo = (
  reserves: ReturnType<typeof createReserves>,
  to: number | undefined,
): void => {
  if (to === undefined) reserves.drop("w");
  else reserves.reserve("w", to, true);
};

describe("reserves", () => {
  it("adds up, and a reserve of nothing or 0 lets it go", () => {
    const reserves = createReserves();
    reserves.reserve("a", 3, true);
    reserves.reserve("b", 2, false);
    expect(reserves.total()).toBe(5);
    reserves.reserve("a", 1, true);
    expect(reserves.total()).toBe(3);
    reserves.reserve("a", 0, true);
    reserves.reserve("b", undefined, false);
    expect(reserves.total()).toBe(0);
  });

  it("has nothing to wait on with no worker's reserve but its own", async () => {
    const reserves = createReserves();
    expect(await reserves.freed("a", never)).toBe(false);
    reserves.reserve("a", 3, true);
    reserves.reserve("lead", 3, false);
    expect(await reserves.freed("a", never)).toBe(false);
  });

  it.each([
    ["shrinks", 1],
    ["is let go", 0],
    ["is dropped", undefined],
  ])("wakes a waiter when a worker's reserve %s", async (_name, to) => {
    const reserves = createReserves();
    reserves.reserve("w", 3, true);
    const waiting = reserves.freed("a", never);
    expect(await settledYet(waiting)).toBe(false);
    freeTo(reserves, to);
    expect(await waiting).toBe(true);
  });

  it("stops waiting when the node is stopped", async () => {
    const reserves = createReserves();
    reserves.reserve("w", 3, true);
    const stop = new AbortController();
    const waiting = reserves.freed("a", stop.signal);
    stop.abort();
    expect(await waiting).toBe(false);
  });

  it("does not wake a waiter when a reserve grows", async () => {
    const reserves = createReserves();
    reserves.reserve("w", 1, true);
    const waiting = reserves.freed("a", never);
    reserves.reserve("w", 2, true);
    expect(await settledYet(waiting)).toBe(false);
  });
});

describe("reserves in a run's spending", () => {
  it("leaves what running sessions were given out of what is offered", () => {
    const spend = createSpend(10);
    spend.reserve("a", 4, true);
    spend.reserve("b", 4, true);
    expect(spend.budgetLeft()).toBe(2);
    expect(spend.left()).toBe(2);
  });

  it("never ends the run on reserves alone", () => {
    const spend = createSpend(10);
    spend.reserve("a", 10, true);
    expect(spend.budgetLeft()).toBe(0);
    expect(spend.spentOut()).toBeNull();
  });

  it("lets a node's reserve go when the node settles, whatever ended it", () => {
    const spend = createSpend(10);
    spend.reserve("a", 6, true);
    spend.report("a", "s", 2);
    expect(spend.budgetLeft()).toBe(2);
    spend.count(
      "a",
      { ok: false, output: {}, error: "x", sessionId: "s", usage: cost(2) },
      false,
    );
    spend.settled("a");
    expect(spend.budgetLeft()).toBe(8);
  });

  it("starts a resumed run with no reserves", () => {
    const spend = createSpend(10, { total: 3, reported: new Map() });
    expect(spend.budgetLeft()).toBe(7);
  });
});

/** A session's usage that cost `usd`. */
const cost = (usd: number) => ({
  costUsd: usd,
  inputTokens: 1,
  outputTokens: 1,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  turns: 1,
  durationMs: 1,
});
