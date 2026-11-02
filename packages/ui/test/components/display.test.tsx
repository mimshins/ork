/**
 * @file Tests for the tabs, the toast, the status badge, the meter, the key
 *   hint, the empty state and the copy-command field: each says what it means
 *   in words, what can be used works from the keyboard, and each has no
 *   accessibility violations.
 */

import { act, cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EmptyState, Kbd } from "../../src/components/bits.tsx";
import { CopyCommand } from "../../src/components/copy-command.tsx";
import { Meter } from "../../src/components/meter.tsx";
import {
  type Status,
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
});

describe("the small pieces", () => {
  it("the key hint marks each key, and passes axe", async () => {
    const { container } = render(<Kbd keys={["⌘", "K"]} />);
    expect(container.querySelectorAll("kbd")).toHaveLength(2);
    expect(await violations(container)).toEqual([]);
  });

  it("the empty state says what is missing and the next step", async () => {
    const { container } = render(
      <EmptyState title="No runs yet.">
        Start one with Run workflow or <code>ork run &lt;workflow&gt;</code>.
      </EmptyState>,
    );
    expect(screen.getByText("No runs yet.")).toBeDefined();
    expect(screen.getByText("ork run <workflow>")).toBeDefined();
    expect(await violations(container)).toEqual([]);
  });
});

/** Jsdom has no clipboard: gives the page one that does `writeText`. */
const stubClipboard = (writeText: (text: string) => Promise<void>) => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
};

describe("the copy-command field", () => {
  it("copies from the keyboard, says so, and passes axe", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(() =>
      Promise.resolve(),
    );
    stubClipboard(writeText);
    const { container } = render(<CopyCommand command="ork logs 4f2a1c" />);
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    expect(writeText).toHaveBeenCalledWith("ork logs 4f2a1c");
    expect((await screen.findByRole("status")).textContent).toBe("Copied.");
    expect(await violations(container)).toEqual([]);
  });

  it("says what to do when the copy fails", async () => {
    stubClipboard(() => Promise.reject(new Error("denied")));
    render(<CopyCommand command="ork logs 4f2a1c" />);
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe(
        "Copy failed: select the text instead.",
      );
    });
  });
});
