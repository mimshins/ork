/**
 * @file Tests for the real `onInterrupt` of `ork run`: a terminal signal asks
 *   the run to stop once, and a second signal asks nothing more. The test
 *   process's own listeners are set aside and restored around each test.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { onInterrupt } from "../src/commands/run.ts";

const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

type Listener = NodeJS.SignalsListener;

let held: Record<string, Listener[]> = {};

/**
 * Sets aside the listeners the test process already has, so a signal reaches
 * only ours.
 */
const setAside = () => {
  held = {};
  for (const signal of SIGNALS) {
    held[signal] = process.listeners(signal);
    process.removeAllListeners(signal);
  }
};

/**
 * Puts back exactly the listeners that were set aside, dropping any added
 * since.
 */
const putBack = () => {
  for (const signal of SIGNALS) {
    process.removeAllListeners(signal);
    for (const listener of held[signal] ?? []) process.on(signal, listener);
  }
};

const counts = () => SIGNALS.map(signal => process.listenerCount(signal));

describe("onInterrupt", () => {
  beforeEach(() => {
    setAside();
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
  });
  afterEach(() => {
    putBack();
    vi.restoreAllMocks();
  });

  it("stops once on SIGINT, and a second signal stops nothing more", () => {
    const stop = vi.fn<() => void>();
    onInterrupt(stop);
    expect(counts()).toEqual([1, 1, 1]);

    process.emit("SIGINT");
    expect(stop).toHaveBeenCalledTimes(1);

    process.emit("SIGINT");
    process.emit("SIGTERM");
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
