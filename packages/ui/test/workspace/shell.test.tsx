/**
 * @file Tests for the workspace's frame: the Window menu, the command palette,
 *   the keyboard, and the stack a narrow window gets instead of a dock.
 */

import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { violations } from "../axe.ts";
import { stubWindow } from "../dom.ts";
import { keys, openShell, railNames, tabNames } from "./harness.tsx";

let setWide: (wide: boolean) => void;

beforeEach(() => {
  localStorage.clear();
  ({ setWide } = stubWindow());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const openMenu = async (user: ReturnType<typeof keys>) => {
  await user.click(screen.getByRole("button", { name: "Window" }));
  return screen.findByRole("menu");
};

const openPalette = async (user: ReturnType<typeof keys>) => {
  await user.keyboard("{Control>}k{/Control}");
  const palette = await screen.findByRole("dialog", {
    name: "Command palette",
  });
  // Focus reaches the search a frame after the dialog appears.
  await waitFor(() => {
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Search commands",
    );
  });
  return palette;
};

const narrow = () => {
  const shell = openShell();
  act(() => {
    setWide(false);
  });
  return shell;
};

const heading = (name: string) => screen.getByRole("button", { name });

describe("the Window menu", () => {
  it("says which panels are minimized or closed", async () => {
    const user = keys();
    const { workspace } = openShell();
    act(() => {
      workspace.minimize("logs");
      workspace.close("runs");
    });
    const menu = await openMenu(user);
    expect(
      within(menu).getByRole("menuitem", { name: /Logs/u }).textContent,
    ).toContain("minimized");
    expect(
      within(menu).getByRole("menuitem", { name: /Runs/u }).textContent,
    ).toContain("closed");
    expect(
      within(menu).getByRole("menuitem", { name: /Monitor/u }).textContent,
    ).not.toMatch(/minimized|closed/u);
  });

  it("brings a closed panel back", async () => {
    const user = keys();
    const { workspace } = openShell();
    act(() => {
      workspace.close("runs");
    });
    const menu = await openMenu(user);
    await user.click(within(menu).getByRole("menuitem", { name: /Runs/u }));
    expect(tabNames()).toContain("Runs");
  });

  it("resets the layout", async () => {
    const user = keys();
    const { workspace } = openShell();
    act(() => {
      workspace.minimize("logs");
    });
    const menu = await openMenu(user);
    await user.click(
      within(menu).getByRole("menuitem", { name: "Reset layout" }),
    );
    expect(railNames()).toEqual([]);
    expect(tabNames()).toContain("Logs");
  });
});

describe("the command palette", () => {
  it("opens on its keys and on its button, with focus in the search", async () => {
    const user = keys();
    const { workspace } = openShell();
    await openPalette(user);
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Search commands",
    );
    act(() => {
      void workspace.palette.setValue(false);
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    await user.click(screen.getByRole("button", { name: /Commands/u }));
    expect(await screen.findByRole("dialog")).toBeDefined();
  });

  it("has no accessibility violations", async () => {
    const user = keys();
    const { baseElement } = openShell();
    await openPalette(user);
    expect(await violations(baseElement)).toEqual([]);
  });

  it("filters as you type and runs the command on Enter", async () => {
    const user = keys();
    openShell();
    await openPalette(user);
    await user.keyboard("minimize");
    const options = await screen.findAllByRole("option");
    expect(options.map(option => option.textContent)).toEqual([
      expect.stringContaining("Minimize Monitor"),
    ]);
    await user.keyboard("{Enter}");
    await waitFor(() => {
      expect(railNames()).toEqual(["Restore Monitor"]);
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says when nothing matches", async () => {
    const user = keys();
    openShell();
    await openPalette(user);
    await user.keyboard("zzzz");
    expect(await screen.findByText("No command matches.")).toBeDefined();
  });

  it("shows why a command cannot run", async () => {
    const user = keys();
    const { workspace } = openShell();
    act(() => {
      workspace.goTo("logs");
      workspace.toggleFloat();
    });
    await openPalette(user);
    const option = await screen.findByRole("option", {
      name: /Maximize Logs/u,
    });
    expect(option.textContent).toContain(
      "A floating panel cannot be maximized.",
    );
    expect(option.getAttribute("aria-disabled")).toBe("true");
  });
});

describe("the keyboard", () => {
  it("runs a command on its keys", async () => {
    const user = keys();
    openShell();
    await user.keyboard("{Alt>}{Shift>}m{/Shift}{/Alt}");
    expect(railNames()).toEqual(["Restore Monitor"]);
  });

  it("goes to a panel by its number", async () => {
    const user = keys();
    const { workspace } = openShell();
    await user.keyboard("{Alt>}{Shift>}3{/Shift}{/Alt}");
    expect(workspace.view.getValue().active).toBe("logs");
  });

  it("leaves plain typing alone", async () => {
    const user = keys();
    const { workspace } = openShell();
    await user.keyboard("m3");
    expect(railNames()).toEqual([]);
    expect(workspace.view.getValue().active).toBe("monitor");
  });

  it("takes no workspace keys while the palette is open", async () => {
    const user = keys();
    openShell();
    await user.keyboard("{Control>}k{/Control}");
    await screen.findByRole("dialog");
    await user.keyboard("{Alt>}{Shift>}m{/Shift}{/Alt}");
    expect(railNames()).toEqual([]);
  });

  it("says why a command cannot run instead of running it", async () => {
    const user = keys();
    const { workspace } = openShell();
    act(() => {
      setWide(false);
    });
    await user.keyboard("{Alt>}{Shift>}m{/Shift}{/Alt}");
    expect(workspace.announcement.getValue()).toBe(
      "Needs a window at least 1024 px wide.",
    );
  });

  it("speaks changes through one polite live region", () => {
    const { workspace } = openShell();
    act(() => {
      workspace.minimize("logs");
    });
    const region = screen.getByText("Logs minimized.");
    expect(region.getAttribute("aria-live")).toBe("polite");
  });
});

describe("a narrow window", () => {
  it("stacks every panel in place of the dock", () => {
    narrow();
    expect(screen.queryAllByRole("tab")).toEqual([]);
    expect(screen.getAllByRole("region").length).toBeGreaterThanOrEqual(6);
    expect(
      screen.getByRole("heading", { level: 2, name: "Monitor" }),
    ).toBeDefined();
  });

  it("has no accessibility violations", async () => {
    const { container } = narrow();
    expect(await violations(container)).toEqual([]);
  });

  it("folds a panel from its heading and remembers it", async () => {
    const user = keys();
    const { workspace } = narrow();
    expect(heading("Logs").getAttribute("aria-expanded")).toBe("true");
    await user.click(heading("Logs"));
    expect(heading("Logs").getAttribute("aria-expanded")).toBe("false");
    expect(workspace.layout.getValue().folded).toEqual(["logs"]);
    await user.click(heading("Logs"));
    expect(heading("Logs").getAttribute("aria-expanded")).toBe("true");
  });

  it("unfolds and focuses a panel it is sent to", async () => {
    const user = keys();
    const { workspace } = narrow();
    await user.click(heading("Logs"));
    act(() => {
      workspace.goTo("logs");
    });
    expect(heading("Logs").getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(heading("Logs"));
  });

  it("gets the dock back, as it was, when the window grows", () => {
    const { workspace } = openShell();
    act(() => {
      workspace.close("runs");
    });
    act(() => {
      setWide(false);
    });
    expect(screen.queryAllByRole("tab")).toEqual([]);
    act(() => {
      setWide(true);
    });
    expect(tabNames()).not.toContain("Runs");
    expect(tabNames()).toContain("Monitor");
  });
});
