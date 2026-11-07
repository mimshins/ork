/**
 * @file Tests for the dock on real dockview: the default layout, minimize and
 *   restore, closing and reopening, moving by keyboard, floating and docking,
 *   maximizing, the saved layout coming back after a reload, and a heading for
 *   each panel.
 */

import { act, cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { violations } from "../axe.ts";
import { stubWindow } from "../dom.ts";
import { keys, openShell, railNames, tabNames } from "./harness.tsx";

const ALL = [
  "Builder",
  "Chats",
  "Context",
  "Decisions",
  "Feedback",
  "Logs",
  "Monitor",
  "Notifications",
  "Runs",
  "Usage",
  "Worktrees",
];

beforeEach(() => {
  localStorage.clear();
  stubWindow();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const tabsBeside = (name: string): string[] =>
  [
    ...(screen
      .getByRole("tab", { name })
      .closest('[role="tablist"]')
      ?.querySelectorAll('[role="tab"]') ?? []),
  ].map(tab => tab.getAttribute("aria-label") ?? "");

const focused = () => document.activeElement?.getAttribute("aria-label");

const reload = async (first: ReturnType<typeof openShell>) => {
  // dockview tells its listeners about a layout change a moment later.
  await new Promise(resolve => {
    setTimeout(resolve, 20);
  });
  first.unmount();
  cleanup();
  return openShell();
};

describe("the dock", () => {
  it("opens every panel in the default layout", () => {
    const { workspace } = openShell();
    expect(tabNames()).toEqual(ALL);
    expect(tabsBeside("Logs")).toEqual([
      "Logs",
      "Chats",
      "Usage",
      "Feedback",
      "Worktrees",
    ]);
    expect(tabsBeside("Decisions")).toEqual(["Decisions", "Notifications"]);
    expect(tabsBeside("Context")).toEqual(["Context"]);
    expect(workspace.view.getValue().active).toBe("monitor");
    expect(workspace.announcement.getValue()).toBe("");
  });

  it("heads each panel for a screen reader, so its cards don't skip a level", () => {
    openShell();
    const headings = screen
      .getAllByRole("heading", { level: 2 })
      .map(heading => heading.textContent);
    expect(headings).toEqual(
      expect.arrayContaining(["Runs", "Monitor", "Logs", "Decisions"]),
    );
  });

  it("has no accessibility violations", async () => {
    const { container } = openShell();
    expect(await violations(container)).toEqual([]);
  });

  it("names each header button and its keys", () => {
    openShell();
    const minimize = screen.getByRole("button", { name: "Minimize Monitor" });
    expect(minimize.getAttribute("aria-keyshortcuts")).toBe("Alt+Shift+M");
    for (const name of ["Maximize", "Float", "Close"]) {
      expect(
        screen.getByRole("button", { name: `${name} Monitor` }),
      ).toBeDefined();
    }
  });

  it("minimizes to the rail and restores to the same group and place", async () => {
    const user = keys();
    const { workspace } = openShell();
    await user.click(screen.getByRole("button", { name: "Minimize Logs" }));
    expect(tabsBeside("Chats")).toEqual([
      "Chats",
      "Usage",
      "Feedback",
      "Worktrees",
    ]);
    expect(railNames()).toEqual(["Restore Logs"]);
    expect(workspace.announcement.getValue()).toBe("Logs minimized.");
    await user.click(screen.getByRole("button", { name: "Restore Logs" }));
    expect(tabsBeside("Logs")).toEqual([
      "Logs",
      "Chats",
      "Usage",
      "Feedback",
      "Worktrees",
    ]);
    expect(railNames()).toEqual([]);
    await vi.waitFor(
      () => {
        expect(workspace.announcement.getValue()).toBe("Logs restored.");
      },
      { timeout: 2000 },
    );
  });

  it("restores a panel that had a group to itself beside its neighbor", () => {
    const { workspace } = openShell();
    act(() => {
      workspace.minimize("monitor");
    });
    expect(tabNames()).not.toContain("Monitor");
    act(() => {
      workspace.restore("monitor");
    });
    expect(tabsBeside("Monitor")).toEqual(["Monitor", "Builder"]);
    expect(tabNames()).toEqual(ALL);
  });

  it("puts focus on the next tab after a minimize", async () => {
    const { workspace } = openShell();
    act(() => {
      workspace.minimize("monitor");
    });
    await waitFor(() => {
      expect(document.activeElement?.getAttribute("role")).toBe("tab");
    });
  });

  it("puts focus on the rail when the last panel is minimized", async () => {
    const { workspace } = openShell();
    act(() => {
      for (const id of [
        "monitor",
        "builder",
        "logs",
        "chats",
        "runs",
        "decisions",
        "notifications",
        "context",
        "usage",
        "feedback",
        "worktrees",
      ] as const) {
        workspace.minimize(id);
      }
    });
    expect(tabNames()).toEqual([]);
    await waitFor(() => {
      expect(document.activeElement?.getAttribute("aria-label")).toBe(
        "Restore Worktrees",
      );
    });
    expect(screen.getByText("No panels open.")).toBeDefined();
  });

  it("reopens a closed panel as a tab, and goes to an open one", () => {
    const { workspace } = openShell();
    act(() => {
      workspace.close("runs");
    });
    expect(tabNames()).not.toContain("Runs");
    expect(workspace.view.getValue().open).not.toContain("runs");
    act(() => {
      workspace.goTo("runs");
    });
    expect(tabNames()).toEqual(ALL);
    expect(workspace.view.getValue().active).toBe("runs");
  });

  it("brings a minimized panel back when asked to go to it", () => {
    const { workspace } = openShell();
    act(() => {
      workspace.minimize("logs");
      workspace.goTo("logs");
    });
    expect(tabsBeside("Logs")).toEqual([
      "Logs",
      "Chats",
      "Usage",
      "Feedback",
      "Worktrees",
    ]);
    expect(railNames()).toEqual([]);
  });

  // Which group is the neighbor depends on drawn positions, which jsdom lacks:
  // here the panel takes the workspace's edge, and the tab case is a browser check.
  it("moves a panel by keyboard and says so", async () => {
    const { workspace } = openShell();
    act(() => {
      workspace.goTo("logs");
      workspace.move("right");
    });
    expect(tabNames()).toEqual(ALL);
    expect(tabsBeside("Logs")).toEqual(["Logs"]);
    await vi.waitFor(() => {
      expect(workspace.announcement.getValue()).toBe("Logs moved right.");
    });
  });

  it("floats a group and docks it back beside its neighbor", () => {
    const { workspace } = openShell();
    act(() => {
      workspace.goTo("logs");
      workspace.toggleFloat();
    });
    expect(workspace.view.getValue().floating).toBe(true);
    expect(screen.getByRole("button", { name: "Dock Logs" })).toBeDefined();
    act(() => {
      workspace.toggleFloat();
    });
    expect(workspace.view.getValue().floating).toBe(false);
    expect(tabsBeside("Logs")).toEqual([
      "Logs",
      "Chats",
      "Usage",
      "Feedback",
      "Worktrees",
    ]);
  });

  it("maximizes a group, offers to restore it, and restores", () => {
    const { workspace } = openShell();
    act(() => {
      workspace.goTo("logs");
      workspace.toggleMaximize();
    });
    expect(workspace.view.getValue().maximized).toBe(true);
    expect(screen.getByRole("button", { name: "Restore Logs" })).toBeDefined();
    act(() => {
      workspace.toggleMaximize();
    });
    expect(workspace.view.getValue().maximized).toBe(false);
  });

  it("cycles focus through the groups, both ways", async () => {
    const { workspace } = openShell();
    act(() => {
      workspace.cycleGroup(1);
    });
    const next = focused();
    expect(next).not.toBe("Monitor");
    act(() => {
      workspace.cycleGroup(-1);
    });
    await waitFor(() => {
      expect(focused()).toBe("Monitor");
    });
  });
});

describe("the saved layout", () => {
  it("comes back with the dock and the rail as they were", async () => {
    const first = openShell();
    act(() => {
      first.workspace.minimize("logs");
      first.workspace.close("runs");
    });
    await reload(first);
    expect(tabNames()).toEqual([
      "Builder",
      "Chats",
      "Context",
      "Decisions",
      "Feedback",
      "Monitor",
      "Notifications",
      "Usage",
      "Worktrees",
    ]);
    expect(railNames()).toEqual(["Restore Logs"]);
  });

  it("can still restore to the old place after a reload", async () => {
    const first = openShell();
    act(() => {
      first.workspace.minimize("logs");
    });
    const { workspace } = await reload(first);
    act(() => {
      workspace.restore("logs");
    });
    expect(tabsBeside("Logs")).toEqual([
      "Logs",
      "Chats",
      "Usage",
      "Feedback",
      "Worktrees",
    ]);
  });

  it("keeps a layout saved without a panel, and opens it when asked", async () => {
    const first = openShell();
    act(() => {
      first.workspace.close("feedback");
    });
    const { workspace } = await reload(first);
    expect(tabNames()).not.toContain("Feedback");
    act(() => {
      workspace.goTo("feedback");
    });
    expect(tabNames()).toEqual(ALL);
    expect(workspace.view.getValue().active).toBe("feedback");
  });

  it("falls back to the default when it is damaged, and says so", () => {
    localStorage.setItem(
      "ork.layout.v1",
      JSON.stringify({ value: { dock: 1 }, timestamp: 1 }),
    );
    const onLayoutDropped = vi.fn<() => void>();
    openShell({ onLayoutDropped });
    expect(tabNames()).toEqual(ALL);
    expect(onLayoutDropped).toHaveBeenCalledOnce();
  });

  it("falls back when dockview cannot read it", () => {
    localStorage.setItem(
      "ork.layout.v1",
      JSON.stringify({
        value: {
          dock: {
            grid: { root: { type: "nonsense" } },
            panels: { one: { id: "one", contentComponent: "runs" } },
          },
          minimized: [],
          folded: [],
        },
        timestamp: 1,
      }),
    );
    const onLayoutDropped = vi.fn<() => void>();
    openShell({ onLayoutDropped });
    expect(tabNames()).toEqual(ALL);
    expect(onLayoutDropped).toHaveBeenCalledOnce();
  });

  it("does not warn about a browser with no saved layout", () => {
    const onLayoutDropped = vi.fn<() => void>();
    openShell({ onLayoutDropped });
    expect(onLayoutDropped).not.toHaveBeenCalled();
  });

  it("resets to the default, with nothing on the rail", async () => {
    const first = openShell();
    act(() => {
      first.workspace.minimize("logs");
      first.workspace.close("runs");
      first.workspace.resetLayout();
    });
    expect(tabNames()).toEqual(ALL);
    expect(railNames()).toEqual([]);
    await vi.waitFor(
      () => {
        expect(first.workspace.announcement.getValue()).toContain(
          "Layout reset.",
        );
      },
      { timeout: 2000 },
    );
    await reload(first);
    expect(tabNames()).toEqual(ALL);
  });
});
