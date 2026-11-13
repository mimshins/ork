/**
 * @file Tests for the Worktrees panel's filter bar: the shared bar on the
 *   `worktrees` list with the registered projects as suggestions; a project
 *   typed in reads again with the table's query and shows only its card; a
 *   value the server refuses shows its words inline and keeps the list; Clear
 *   filter resets; the matching command shows while a filter is set.
 */

import { cleanup, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { stubWindow } from "../dom.ts";
import { BUILD } from "./worktrees-fixtures.ts";
import {
  asked,
  type OpenedWorktrees,
  openWorktrees,
  rowOf,
} from "./worktrees-harness.tsx";

beforeEach(() => {
  localStorage.clear();
  stubWindow();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const waitForQuery = async (
  opened: OpenedWorktrees,
  query: unknown,
): Promise<void> => {
  await vi.waitFor(() => {
    expect(asked(opened, "list").at(-1)?.body).toEqual(query);
  });
};

describe("the Worktrees panel's filter bar", () => {
  it("shows the bar with Run and Project, and no filter set", async () => {
    await openWorktrees();
    expect(
      screen.getByRole("search", { name: "Filter worktrees" }),
    ).toBeDefined();
    expect(screen.getByRole("combobox", { name: "Run" })).toBeDefined();
    expect(screen.getByRole("combobox", { name: "Project" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Clear filter" })).toBeNull();
    expect(
      screen.getByText("2 worktrees · 1 branch without a worktree"),
    ).toBeDefined();
  });

  it("reads again with the project, shows its card and the command", async () => {
    const opened = await openWorktrees();
    await userEvent.type(
      screen.getByRole("combobox", { name: "Project" }),
      "app{Enter}",
    );
    await waitForQuery(opened, { project: "app" });
    expect(await screen.findByText("3 worktrees match.")).toBeDefined();
    expect(screen.getByText("ork worktrees list --project app")).toBeDefined();
    expect(rowOf(BUILD.key)).toBeDefined();
    expect(screen.queryByText(/Nothing left/u)).toBeNull();
  });

  it("reads again with a run", async () => {
    const opened = await openWorktrees();
    await userEvent.type(
      screen.getByRole("combobox", { name: "Run" }),
      "4f2a1c{Enter}",
    );
    await waitForQuery(opened, { run: "4f2a1c" });
    expect(screen.getByText("ork worktrees list --run 4f2a1c")).toBeDefined();
  });

  it("says a refused value inline, on its field, and keeps the list", async () => {
    const opened = await openWorktrees();
    opened.server.refuse = {
      list: {
        status: 400,
        error: "--project is not a registered project: `nope`.",
      },
    };
    await userEvent.type(
      screen.getByRole("combobox", { name: "Project" }),
      "nope{Enter}",
    );
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(
      "--project is not a registered project: nope. The list shows the last filter that worked. Fix the value, or clear the filter.",
    );
    expect(
      screen
        .getByRole("combobox", { name: "Project" })
        .getAttribute("aria-invalid"),
    ).toBe("true");
    expect(screen.queryByText(/Could not read worktrees/u)).toBeNull();
    expect(rowOf(BUILD.key)).toBeDefined();
  });

  it("clears the filter with Clear filter and reads every project again", async () => {
    const opened = await openWorktrees();
    await userEvent.type(
      screen.getByRole("combobox", { name: "Project" }),
      "app{Enter}",
    );
    await waitForQuery(opened, { project: "app" });
    await userEvent.click(
      await screen.findByRole("button", { name: "Clear filter" }),
    );
    await waitForQuery(opened, {});
    expect(screen.queryByText("ork worktrees list --project app")).toBeNull();
    expect(await screen.findByText("Filter cleared.")).toBeDefined();
    expect(rowOf(BUILD.key)).toBeDefined();
  });

  it("says nothing matches, with Clear filter, when the filter leaves none", async () => {
    await openWorktrees();
    await userEvent.type(
      screen.getByRole("combobox", { name: "Project" }),
      "web{Enter}",
    );
    expect(
      await screen.findByText("No worktrees match the filter."),
    ).toBeDefined();
  });
});
