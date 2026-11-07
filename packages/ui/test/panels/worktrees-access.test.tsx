/**
 * @file Accessibility checks of the Worktrees panel's failures and names: a
 *   failed list read says so (and Clean merged… says why it waits), a card git
 *   couldn't read gives its fix as a command block, a failed plan read fills
 *   its failure slot without looking like it still reads, each passing axe; a
 *   row's Remove… keeps its CLI twin in its description; and removing the only
 *   row puts the focus on the empty state's title.
 */

import { cleanup, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { violations } from "../axe.ts";
import { stubWindow } from "../dom.ts";
import { describedBy } from "./feedback-harness.tsx";
import { BUILD, LEAD, project } from "./worktrees-fixtures.ts";
import {
  dialog,
  openWorktrees,
  removeOf,
  settle,
} from "./worktrees-harness.tsx";

beforeEach(() => {
  localStorage.clear();
  stubWindow();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const refused = (route: string, error: string) => ({
  [route]: { status: 500, error },
});

describe("the Worktrees panel's failures, by axe", () => {
  it("says a failed list read once, and why Clean merged… waits", async () => {
    const { view } = await openWorktrees({
      refuse: refused("list", "No answer."),
    });
    expect(screen.getByRole("alert").textContent).toBe(
      "Could not read worktrees: No answer.",
    );
    expect(
      screen.getByRole("button", {
        name: "Clean merged…: the worktrees couldn't be read",
      }),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Reload" })).toBeDefined();
    expect(await violations(view.container)).toEqual([]);
  });

  it("gives a gone folder's fix as a command, with no branch to measure", async () => {
    const { view } = await openWorktrees({
      projects: [
        project("app", [], {
          head: null,
          error: "its folder /code/app is gone.",
          fix: "ork projects move app <new path>",
        }),
      ],
    });
    expect(screen.getByText("/code/app")).toBeDefined();
    expect(screen.queryByText(/detached HEAD/u)).toBeNull();
    expect(screen.getByText("ork projects move app <new path>").tagName).toBe(
      "CODE",
    );
    expect(await violations(view.container)).toEqual([]);
  });

  it("fills Remove…'s failure slot, and doesn't look like it still reads", async () => {
    await openWorktrees({ refuse: refused("removePlan", "git failed.") });
    await userEvent.click(removeOf(BUILD.key));
    await vi.waitFor(() => {
      expect(dialog().getByRole("alert").textContent).toBe(
        "Could not read its state: git failed.",
      );
    });
    const well = dialog().getByRole("region", { name: "Plan" });
    expect(well.getAttribute("aria-busy")).toBe("false");
    expect(well.textContent).toBe(
      "Nothing to show: its state couldn't be read.",
    );
    expect(
      describedBy(dialog().getByRole("button", { name: "Remove worktree" })),
    ).toContain("Its state couldn't be read; Try again reads it.");
    expect(await violations(document.body)).toEqual([]);
  });

  it("fills Clean merged…'s failure slot, its well no longer busy", async () => {
    await openWorktrees({ refuse: refused("cleanPlan", "git failed.") });
    await userEvent.click(
      screen.getByRole("button", { name: "Clean merged…" }),
    );
    await vi.waitFor(() => {
      expect(dialog().getByRole("alert").textContent).toBe(
        "Could not read the plan: git failed.",
      );
    });
    const well = dialog().getByRole("region", { name: "Plan for app" });
    expect(well.getAttribute("aria-busy")).toBe("false");
    expect(well.textContent).toBe(
      "Nothing to show: the plan couldn't be read.",
    );
    expect(await violations(document.body)).toEqual([]);
  });
});

describe("the Worktrees panel's names and focus", () => {
  it("keeps the row's CLI twin in Remove…'s description", async () => {
    await openWorktrees();
    expect(describedBy(removeOf(LEAD.key))).toContain(
      "CLI: cd /code/app && ork worktrees remove ork/9b1e07/lead",
    );
  });

  it("puts the focus on the empty state's title when the only row goes", async () => {
    await openWorktrees({ projects: [project("app", [BUILD])] });
    await userEvent.click(removeOf(BUILD.key));
    await vi.waitFor(() => {
      expect(dialog().getByRole("region", { name: "Plan" }).textContent).toBe(
        "ork/4f2a1c/build: remove worktree",
      );
    });
    await userEvent.click(
      dialog().getByRole("button", { name: "Remove worktree" }),
    );
    await settle();
    await vi.waitFor(() => {
      expect(document.activeElement?.textContent).toBe(
        "No Ork worktrees or branches.",
      );
    });
    expect(within(document.body).queryByRole("dialog")).toBeNull();
  });
});
