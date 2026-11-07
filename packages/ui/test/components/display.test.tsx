/**
 * @file Tests for the tabs, the toast, the status badge and the meter: each
 *   says what it means in words, what can be used works from the keyboard, and
 *   each has no accessibility violations. The key hint, the empty state and the
 *   copy-command block are in copy-blocks.test.tsx.
 */

import { act, cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { blocksOn, Meter } from "../../src/components/meter.tsx";
import {
  type Status,
  ItemStatusBadge,
  StatusBadge,
} from "../../src/components/status-badge.tsx";
import { Tabs } from "../../src/components/tabs.tsx";
import { Toasts, toasts } from "../../src/components/toast.tsx";
import { violations } from "../axe.ts";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the tabs", () => {
  it("move with the arrow keys, show their panel, and pass axe", async () => {
    render(
      <Tabs
        label="Run details"
        tabs={[
          { id: "graph", label: "Graph", panel: <p>The graph</p> },
          { id: "tree", label: "Tree", panel: <p>The tree</p> },
        ]}
      />,
    );
    expect(screen.getByRole("tablist", { name: "Run details" })).toBeDefined();
    expect(screen.getByText("The graph")).toBeDefined();
    await userEvent.tab();
    await userEvent.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(
      screen.getByRole("tab", { name: "Tree" }),
    );
    await userEvent.keyboard("{Enter}");
    expect(await screen.findByText("The tree")).toBeDefined();
    expect(await violations(document.body)).toEqual([]);
  });
});

describe("the toast", () => {
  it("is added from outside React, passes axe, and F6 reaches its dismiss", async () => {
    render(<Toasts />);
    act(() => {
      toasts.add({
        title: "build failed",
        description: "exit 1",
        timeout: 0,
      });
    });
    expect(await screen.findByText("build failed")).toBeDefined();
    expect(screen.getByText("exit 1")).toBeDefined();
    expect(await violations(document.body)).toEqual([]);
    await userEvent.keyboard("{F6}");
    await userEvent.tab();
    expect(document.activeElement?.getAttribute("role")).toBe("dialog");
    await userEvent.tab();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Dismiss" }),
    );
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => {
      expect(screen.queryByText("build failed")).toBeNull();
    });
  });
});

const WORDS: [Status, string][] = [
  ["running", "running"],
  ["succeeded", "succeeded"],
  ["waiting", "waiting on you"],
  ["paused", "paused"],
  ["failed", "failed"],
  ["crashed", "crashed"],
  ["queued", "queued"],
  ["skipped", "skipped"],
  ["interrupted", "interrupted"],
  ["timed_out", "timed out"],
  ["budget_exhausted", "budget exhausted"],
];

const TONES: Status[] = ["running", "succeeded", "waiting", "paused", "failed"];

describe("the status badge", () => {
  it.each(WORDS)("says %s in words, with an icon", async (status, word) => {
    const { container } = render(<StatusBadge status={status} />);
    expect(screen.getByText(word)).toBeDefined();
    expect(container.querySelector("svg")).not.toBeNull();
    expect(await violations(container)).toEqual([]);
  });

  it("gives each status color its own icon shape", () => {
    const shapes = TONES.map(status => {
      const { container, unmount } = render(<StatusBadge status={status} />);
      const shape = container.querySelector("svg")?.innerHTML;
      unmount();
      return shape;
    });
    expect(new Set(shapes).size).toBe(shapes.length);
  });

  it.each(WORDS)("says %s in words as a pill too", async (status, word) => {
    const { container } = render(
      <StatusBadge
        pill
        status={status}
      />,
    );
    expect(screen.getByText(word)).toBeDefined();
    expect(await violations(container)).toEqual([]);
  });
});

const ITEM_STATUSES = [
  "new",
  "triaged",
  "accepted",
  "resolved",
  "published",
  "dismissed",
] as const;

describe("the item status badge", () => {
  it.each(ITEM_STATUSES)(
    "says %s in words, bare or as a pill",
    async status => {
      const { container } = render(
        <>
          <ItemStatusBadge status={status} />
          <ItemStatusBadge
            pill
            status={status}
          />
        </>,
      );
      expect(screen.getAllByText(status)).toHaveLength(2);
      expect(await violations(container)).toEqual([]);
    },
  );

  it("gives each item status its own shape", () => {
    const shapes = ITEM_STATUSES.map(status => {
      const { container, unmount } = render(
        <ItemStatusBadge status={status} />,
      );
      const shape = container.querySelector("svg")?.innerHTML;
      unmount();
      return shape;
    });
    expect(new Set(shapes).size).toBe(shapes.length);
  });

  it("marks only a new item with attention", () => {
    const tones = ITEM_STATUSES.map(status => {
      const { container, unmount } = render(
        <ItemStatusBadge status={status} />,
      );
      const tone =
        container.querySelector<HTMLElement>("[data-tone]")?.dataset["tone"];
      unmount();
      return tone;
    });
    expect(tones).toEqual([
      "waiting",
      "queued",
      "queued",
      "succeeded",
      "succeeded",
      "skipped",
    ]);
  });
});

describe("the meter", () => {
  it("is a named meter whose value is in words, and passes axe", async () => {
    const { container } = render(
      <Meter
        label="Budget"
        max={2}
        text="$1.42 of $2.00"
        value={1.42}
      />,
    );
    const meter = screen.getByRole("meter", { name: "Budget" });
    expect(meter.getAttribute("aria-valuetext")).toBe("$1.42 of $2.00");
    expect(screen.getByText("$1.42 of $2.00")).toBeDefined();
    expect(await violations(container)).toEqual([]);
  });

  it("keeps its value in range past the limit", () => {
    render(
      <Meter
        label="Budget"
        max={2}
        text="$2.50 of $2.00"
        value={2.5}
      />,
    );
    expect(screen.getByRole("meter").getAttribute("aria-valuenow")).toBe("2");
  });

  it.each([
    ["nothing spent", 0, 2, 0],
    ["a tiny amount, which still shows", 0.001, 2, 1],
    ["about half", 1, 2, 10],
    ["almost all, which isn't full", 1.99, 2, 19],
    ["the limit", 2, 2, 20],
    ["past the limit", 2.5, 2, 20],
    ["a limit of nothing", 0, 0, 20],
  ])("fills its blocks for %s", (_name, value, max, on) => {
    expect(blocksOn(value, max)).toBe(on);
  });

  it.each([
    ["normal", 1],
    ["high", 1.8],
    ["full", 2],
  ])("is %s at %s of 2", (level, value) => {
    render(
      <Meter
        label="Budget"
        max={2}
        text="spent"
        value={value}
      />,
    );
    expect(screen.getByRole("meter").dataset["level"]).toBe(level);
  });
});
