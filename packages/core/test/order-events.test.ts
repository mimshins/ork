/**
 * @file Tests for the store-order buffer (`createOrdered`): a sorted release by
 *   `(at, run, seq)`, a younger item held, a younger item that sorts first
 *   released with the older one, `flush`, `drop`, and a throwing `deliver`.
 */

import { setTimeout as sleep } from "node:timers/promises";

import { describe, expect, it, vi } from "vitest";

import { createOrdered } from "../src/remote/order-events.ts";

/** A buffer that records what it delivers. */
const recorder = (windowMs: number) => {
  const out: string[] = [];
  const ordered = createOrdered<string>(
    item => {
      out.push(item);
    },
    windowMs,
    () => {},
  );
  return { out, ...ordered };
};

const T1 = "2026-11-15T10:00:00.100Z";
const T2 = "2026-11-15T10:00:00.200Z";

describe("createOrdered", () => {
  it("releases held items after the window sorted by at, run, then seq", async () => {
    const { out, push } = recorder(20);
    push("b2", T2, "bbbb", 2);
    push("a1", T2, "aaaa", 1);
    push("b1", T2, "bbbb", 1);
    push("c9", T1, "cccc", 9);
    expect(out).toEqual([]);

    await vi.waitFor(() => {
      expect(out).toEqual(["c9", "a1", "b1", "b2"]);
    });
  });

  it("holds a younger item that sorts after the released ones", () => {
    vi.useFakeTimers();
    try {
      const { out, push } = recorder(200);
      push("old", T1, "aaaa", 1);
      vi.advanceTimersByTime(100);
      push("young", T2, "bbbb", 1);
      // Old is due at 200 ms, young at 300 ms.
      vi.advanceTimersByTime(150);
      expect(out).toEqual(["old"]);
      vi.advanceTimersByTime(100);
      expect(out).toEqual(["old", "young"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("releases a younger item that sorts first with the older one", async () => {
    const { out, push } = recorder(30);
    push("later", T2, "aaaa", 1);
    await sleep(15);
    push("earlier", T1, "bbbb", 1);

    await vi.waitFor(() => {
      expect(out).toEqual(["earlier", "later"]);
    });
  });

  it("flushes everything held, sorted, at once", () => {
    const { out, push, flush } = recorder(10_000);
    push("b", T2, "aaaa", 2);
    push("a", T1, "bbbb", 7);
    flush();
    expect(out).toEqual(["a", "b"]);
  });

  it("drops what it holds and delivers nothing later", async () => {
    const { out, push, flush, drop } = recorder(5);
    push("a", T1, "aaaa", 1);
    drop();
    await sleep(30);
    flush();
    expect(out).toEqual([]);
  });

  it("passes a throw from deliver to onError, never as an uncaught exception", async () => {
    const errors: unknown[] = [];
    const boom = new Error("boom");
    const { push } = createOrdered<string>(
      () => {
        throw boom;
      },
      5,
      error => {
        errors.push(error);
      },
    );
    push("a", T1, "aaaa", 1);
    push("b", T2, "aaaa", 2);

    await vi.waitFor(() => {
      expect(errors).toEqual([boom]);
    });
  });
});
