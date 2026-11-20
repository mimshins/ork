/**
 * @file Tests for the plan limits on the Usage panel: when each was seen, a
 *   stale warning worded and marked apart from a fresh one, and the `ago`
 *   helper that words the age.
 */

import type { LimitsReport } from "@krapht/ork-server/client";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ago } from "../../src/graph/facts.ts";
import { UsageLimits } from "../../src/panels/usage-limits.tsx";
import { violations } from "../axe.ts";

const NOW = Date.parse("2030-01-01T12:00:00.000Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const before = (ms: number): string => new Date(NOW - ms).toISOString();

const RESETS = "2030-01-05T00:00:00.000Z";
const RESETS_SHOWN = new Date(RESETS).toLocaleString(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const planNotes = (plan: LimitsReport["plan"]) => {
  const { container } = render(
    <UsageLimits limits={{ problems: [], caps: [], plan }} />,
  );
  return {
    container,
    notes: [...container.querySelectorAll<HTMLElement>("p")],
  };
};

const isStale = (note: HTMLElement | undefined): boolean =>
  note !== undefined && "stale" in note.dataset;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("the plan limits", () => {
  it("says a fresh warning is close, with when it was seen", () => {
    const [note] = planNotes([
      {
        status: "allowed_warning",
        window: "seven_day",
        resetsAt: RESETS,
        at: before(2 * HOUR),
      },
    ]).notes;
    expect(note?.textContent).toBe(
      `Claude plan's seven day limit is close, resets ${RESETS_SHOWN} (seen 2h ago)`,
    );
    expect(isStale(note)).toBe(false);
  });

  it("says a stale warning was close, and marks it", () => {
    const [note] = planNotes([
      {
        status: "allowed_warning",
        window: "seven_day",
        resetsAt: RESETS,
        at: before(DAY + 2 * HOUR),
        stale: true,
      },
    ]).notes;
    expect(note?.textContent).toBe(
      `Claude plan's seven day limit was close, resets ${RESETS_SHOWN} (seen 1d ago, stale)`,
    );
    expect(isStale(note)).toBe(true);
  });

  it("says a rejected limit was reached, never stale", () => {
    const [note] = planNotes([
      {
        status: "rejected",
        window: "seven_day",
        resetsAt: RESETS,
        at: before(2 * HOUR),
      },
    ]).notes;
    expect(note?.textContent).toBe(
      `Claude plan's seven day limit was reached, resets ${RESETS_SHOWN} (seen 2h ago)`,
    );
    expect(isStale(note)).toBe(false);
  });

  it("drops the reset time when there is none", () => {
    const [note] = planNotes([
      { status: "rejected", window: "five_hour", at: before(HOUR) },
    ]).notes;
    expect(note?.textContent).toBe(
      "Claude plan's five hour limit was reached (seen 1h ago)",
    );
  });

  it("has no violations, fresh and stale", async () => {
    const { container } = planNotes([
      { status: "allowed_warning", window: "five_hour", at: before(HOUR) },
      {
        status: "allowed_warning",
        window: "seven_day",
        at: before(30 * HOUR),
        stale: true,
      },
    ]);
    expect(await violations(container)).toEqual([]);
  });
});

describe("ago", () => {
  it.each([
    [30_000, "just now"],
    [59 * MINUTE + 59_000, "59m ago"],
    [5 * MINUTE, "5m ago"],
    [HOUR, "1h ago"],
    [23 * HOUR + 59 * MINUTE, "23h ago"],
    [DAY, "1d ago"],
    [6 * DAY + 23 * HOUR, "6d ago"],
    [7 * DAY, "2029-12-25"],
  ])("reads %i ms as %s", (ms, text) => {
    expect(ago(before(ms), NOW)).toBe(text);
  });
});
