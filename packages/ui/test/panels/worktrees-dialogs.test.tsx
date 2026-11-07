/**
 * @file Tests for the Worktrees panel's dialogs. Remove… opens on Cancel, shows
 *   the plan and its CLI twin, removes with the plan's digest and says so, the
 *   row gone and the focus on the next row's Remove…; one that loses work goes
 *   on to what's lost, its heading taking the focus, and forces only then; a
 *   plan that changed is shown again. Clean merged… shows each project's plan,
 *   cleans it, and its result takes the focus; cancelled, it says nothing was
 *   removed. Each step passes axe.
 */

import { cleanup, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { violations } from "../axe.ts";
import { stubWindow } from "../dom.ts";
import {
  branchPlans,
  BUILD,
  changingPlans,
  DOCS,
  FORCED,
  LEAD,
  plan,
} from "./worktrees-fixtures.ts";
import {
  announced,
  asked,
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

const readDone = async (text: string): Promise<void> => {
  await vi.waitFor(() => {
    expect(dialog().getByRole("region", { name: "Plan" }).textContent).toBe(
      text,
    );
  });
};

describe("Remove…", () => {
  it("removes what its plan shows, then hands the focus to the next row", async () => {
    const opened = await openWorktrees();
    await userEvent.click(removeOf(BUILD.key));
    await readDone("ork/4f2a1c/build: remove worktree");
    expect(
      screen.getByRole("dialog", { name: "Remove ork/4f2a1c/build" }),
    ).toBeDefined();
    expect(document.activeElement?.textContent).toBe("Cancel");
    expect(
      dialog().getByText("ork worktrees remove ork/4f2a1c/build"),
    ).toBeDefined();
    expect(await violations(document.body)).toEqual([]);
    await userEvent.click(
      dialog().getByRole("button", { name: "Remove worktree" }),
    );
    await settle();
    expect(asked(opened, "remove")[0]?.body).toEqual({
      project: "/code/app",
      key: BUILD.key,
      deleteBranch: false,
      force: false,
      digest: "digest of ork/4f2a1c/build: remove worktree",
    });
    expect(announced(opened)).toBe("Removed ork/4f2a1c/build's worktree.");
    expect(screen.queryByRole("dialog")).toBeNull();
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(removeOf(LEAD.key));
    });
  });

  it("reads the plan again with the branch, and its twin says so", async () => {
    const opened = await openWorktrees({ plans: branchPlans });
    await userEvent.click(removeOf(BUILD.key));
    await readDone("ork/4f2a1c/build: remove worktree");
    await userEvent.click(
      dialog().getByRole("checkbox", {
        name: "Also delete the branch ork/4f2a1c/build",
      }),
    );
    await readDone("ork/4f2a1c/build: remove worktree + delete branch");
    expect(asked(opened, "removePlan")).toHaveLength(2);
    expect(
      dialog().getByText("ork worktrees remove ork/4f2a1c/build --branch"),
    ).toBeDefined();
    expect(
      dialog().getByRole("button", { name: "Remove worktree and branch" }),
    ).toBeDefined();
  });

  it("shows what's lost before a removal that loses it, and forces only then", async () => {
    const opened = await openWorktrees({ plans: () => FORCED });
    await userEvent.click(removeOf(LEAD.key));
    await readDone("ork/9b1e07/lead: remove worktree");
    expect(
      dialog().getByText(
        "It has uncommitted changes; the next step shows what's lost.",
      ),
    ).toBeDefined();
    await userEvent.click(dialog().getByRole("button", { name: "Continue…" }));
    expect(document.activeElement?.textContent).toBe("What's lost");
    expect(
      dialog().getByRole("region", { name: "Uncommitted changes" }).textContent,
    ).toBe(" M src/login.ts\n?? notes.md");
    expect(await violations(document.body)).toEqual([]);
    await userEvent.click(dialog().getByRole("button", { name: "Back" }));
    expect(document.activeElement?.textContent).toBe("Continue…");
    await userEvent.click(dialog().getByRole("button", { name: "Continue…" }));
    await userEvent.click(
      dialog().getByRole("button", { name: "Remove and lose this work" }),
    );
    await settle();
    expect(asked(opened, "remove")[0]?.body).toMatchObject({ force: true });
  });

  it("shows a plan that changed since it was read, and removes nothing", async () => {
    const opened = await openWorktrees({
      plans: changingPlans(),
      refuse: { remove: { status: 409, error: "It changed." } },
    });
    await userEvent.click(removeOf(BUILD.key));
    await readDone("ork/4f2a1c/build: remove worktree");
    await userEvent.click(
      dialog().getByRole("button", { name: "Remove worktree" }),
    );
    await vi.waitFor(() => {
      expect(
        dialog().getByText(
          "It changed since you read it. Read it again before removing.",
        ),
      ).toBeDefined();
    });
    expect(document.activeElement?.textContent).toBe("Continue…");
    expect(asked(opened, "remove")).toHaveLength(1);
  });

  it("deletes a branch with no worktree", async () => {
    await openWorktrees({
      plans: () =>
        plan("ork/77c0de/docs: delete branch", {
          removeWorktree: false,
          deleteBranch: true,
        }),
    });
    await userEvent.click(removeOf(DOCS.key));
    await readDone("ork/77c0de/docs: delete branch");
    expect(
      screen.getByRole("dialog", { name: "Delete branch ork/77c0de/docs" }),
    ).toBeDefined();
    expect(
      dialog().getByRole("button", { name: "Delete branch" }),
    ).toBeDefined();
    expect(dialog().queryByRole("checkbox")).toBeNull();
  });
});

/** Opens Clean merged… and waits for its plan. */
const openClean = async () => {
  const opened = await openWorktrees();
  await userEvent.click(screen.getByRole("button", { name: "Clean merged…" }));
  await vi.waitFor(() => {
    expect(
      dialog().getByRole("region", { name: "Plan for app" }).textContent,
    ).toContain("ork/4f2a1c/build: remove worktree");
  });
  return opened;
};

describe("Clean merged…", () => {
  it("shows each project's plan and cleans exactly it", async () => {
    const opened = await openClean();
    expect(
      screen.getByRole("dialog", { name: "Clean merged worktrees in app" }),
    ).toBeDefined();
    expect(
      dialog().getByText(
        "Removes 1 worktree. Keeps 1: no worktree, branch kept (1).",
      ),
    ).toBeDefined();
    expect(
      dialog().getByText("cd /code/app && ork worktrees clean"),
    ).toBeDefined();
    expect(await violations(document.body)).toEqual([]);
    await userEvent.click(
      dialog().getByRole("button", { name: "Remove 1 worktree" }),
    );
    await settle();
    expect(asked(opened, "clean")[0]?.body).toEqual({
      branches: false,
      digest: "clean digest",
    });
    expect(document.activeElement?.textContent).toBe("Cleaned");
    expect(await violations(document.body)).toEqual([]);
    await userEvent.click(dialog().getByRole("button", { name: "Close" }));
    await vi.waitFor(() => {
      expect(document.activeElement?.textContent).toBe("Clean merged…");
    });
  });

  it("says nothing was removed when cancelled", async () => {
    const opened = await openClean();
    await userEvent.click(dialog().getByRole("button", { name: "Cancel" }));
    expect(announced(opened)).toBe("Nothing was removed.");
    expect(asked(opened, "clean")).toEqual([]);
  });
});
