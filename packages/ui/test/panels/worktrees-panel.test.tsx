/**
 * @file Tests for the Worktrees panel's list: a card per project with something
 *   left, rows in core's words named for what they'd remove, a project git
 *   can't read with its words, the others counted; the filter bar's tests are
 *   in worktrees-filter.test.tsx; Clean merged… says why it can't be pressed;
 *   Open run goes to the Monitor; the arrow keys move among the rows' same
 *   buttons; and the list's states pass axe.
 */

import { cleanup, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { violations } from "../axe.ts";
import { stubWindow } from "../dom.ts";
import { describedBy } from "./feedback-harness.tsx";
import { BUILD, DOCS, LEAD, project, row } from "./worktrees-fixtures.ts";
import { openWorktrees, removeOf, rowOf } from "./worktrees-harness.tsx";

beforeEach(() => {
  localStorage.clear();
  stubWindow();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the Worktrees panel's list", () => {
  it("shows a card per project, its rows in core's words, and counts the rest", async () => {
    const { view } = await openWorktrees();
    expect(screen.getByText("2 worktrees · 1 branch")).toBeDefined();
    const app = screen.getByRole("list", { name: "Worktrees in app" });
    expect(within(app).getAllByRole("listitem")).toHaveLength(3);
    expect(rowOf(LEAD.key).textContent).toContain(
      "uncommitted changes ·3 commits not merged",
    );
    expect(
      screen.getByText(
        "Could not read api's worktrees: Not in a git repository with a commit.",
      ),
    ).toBeDefined();
    expect(screen.getByText("Nothing left in 1 other project.")).toBeDefined();
    expect(await violations(view.container)).toEqual([]);
  });

  it("names each row's buttons for it, Remove… described by what it removes", async () => {
    await openWorktrees();
    const remove = removeOf(LEAD.key);
    expect(remove.getAttribute("aria-label")).toBe("Remove ork/9b1e07/lead…");
    expect(describedBy(remove)).toContain("uncommitted changes");
    expect(removeOf(DOCS.key).getAttribute("aria-label")).toBe(
      "Delete branch ork/77c0de/docs…",
    );
    expect(
      within(rowOf(DOCS.key)).getByRole("button", {
        name: "Open run 77c0de: it isn't in Ork's records",
      }),
    ).toHaveProperty("ariaDisabled", "true");
  });

  it("keeps a row it can't remove, saying why in its name", async () => {
    await openWorktrees({
      projects: [
        project("app", [
          row("ork/r1/lead", {
            remove: {
              label: "Remove…",
              refusal: "run r1 is still going; stop it first",
            },
          }),
        ]),
      ],
    });
    expect(removeOf("ork/r1/lead").getAttribute("aria-label")).toBe(
      "Remove ork/r1/lead…: run r1 is still going; stop it first",
    );
  });

  it("says why Clean merged… can't be pressed", async () => {
    await openWorktrees({ projects: [project("app", [LEAD])] });
    expect(
      screen.getByRole("button", {
        name: "Clean merged…: nothing merged in these projects",
      }),
    ).toHaveProperty("ariaDisabled", "true");
  });

  it("opens a row's run in the Monitor", async () => {
    const opened = await openWorktrees();
    await userEvent.click(
      within(rowOf(BUILD.key)).getByRole("button", {
        name: "Open run 4f2a1c at build",
      }),
    );
    expect(opened.goTo).toHaveBeenCalledWith("monitor");
    expect(opened.state.selection.getValue()).toEqual({
      run: "4f2a1c",
      node: "build",
    });
  });

  it("moves among the rows' same buttons with the arrow keys", async () => {
    await openWorktrees();
    removeOf(BUILD.key).focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(removeOf(LEAD.key));
    await userEvent.keyboard("{End}");
    expect(document.activeElement).toBe(removeOf(DOCS.key));
    await userEvent.keyboard("{Home}");
    expect(document.activeElement).toBe(removeOf(BUILD.key));
  });

  it("says when there's nothing anywhere, and passes axe", async () => {
    const { view } = await openWorktrees({
      projects: [project("app", [])],
    });
    expect(screen.getByText("No Ork worktrees or branches.")).toBeDefined();
    expect(await violations(view.container)).toEqual([]);
  });
});
