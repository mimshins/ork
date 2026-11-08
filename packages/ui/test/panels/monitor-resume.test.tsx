/**
 * @file Tests for the Monitor's Resume on a fake server: only a run that ended
 *   without succeeding offers it, it asks first with its CLI twin as a code
 *   block, it sends `ork resume`'s request only once confirmed, a refusal stays
 *   in its dialog, the keys reach and work it, and the run's heading takes the
 *   focus once the button goes with the run going live.
 */

import type { RunView } from "@krapht/ork-server/client";
import { act, cleanup, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MonitorPanel } from "../../src/panels/monitor-panel.tsx";
import { violations } from "../axe.ts";
import { stubWindow } from "../dom.ts";
import { runView } from "../state/fixtures.ts";
import { type MonitorRoutes, openPanelState, renderPanel } from "./harness.tsx";
import { treeNode } from "./monitor-fixtures.ts";

const ROUTES: MonitorRoutes = {
  graph: {
    nodes: [{ id: "lead", type: "claude.leader" }],
    edges: [],
    channels: [],
  },
  tree: [treeNode("lead", { type: "claude.leader", state: "failed" })],
};

const open = async (run: RunView, monitor: MonitorRoutes = ROUTES) => {
  const opened = openPanelState({ monitor });
  renderPanel(opened.state, <MonitorPanel />);
  await act(async () => {
    opened.overview.send("runs", [run]);
    opened.overview.send("decisions", []);
    opened.state.selectRun(run.id);
    await Promise.resolve();
  });
  await screen.findByRole("treeitem", { name: /^lead,/u });
  return opened;
};

const resumeButton = (): HTMLElement =>
  screen.getByRole("button", { name: "Resume run" });

beforeEach(() => {
  localStorage.clear();
  stubWindow();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the Monitor's Resume", () => {
  it.each(["failed", "interrupted", "crashed", "budget_exhausted"] as const)(
    "is offered for a run that ended %s",
    async live => {
      await open(runView("aaa11111", live));
      expect(resumeButton().getAttribute("aria-disabled")).not.toBe("true");
    },
  );

  it.each(["running", "paused", "succeeded"] as const)(
    "is not offered for a run that is %s",
    async live => {
      await open(runView("aaa11111", live));
      expect(screen.queryByRole("button", { name: /^Resume/u })).toBeNull();
    },
  );

  it("says why a run of one node can't be resumed", async () => {
    await open(runView("node-aaa1", "failed"));
    expect(
      screen
        .getByRole("button", {
          name: "Resume run: it ran one node; run that node again instead",
        })
        .getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("asks first, shows its command as a code block, then resumes", async () => {
    const user = userEvent.setup();
    const { controlled } = await open(runView("aaa11111", "interrupted"));
    await user.click(resumeButton());
    const dialog = await screen.findByRole("alertdialog", {
      name: "Resume run aaa11111?",
    });
    expect(dialog.textContent).toContain("paid run");
    expect(
      within(dialog).getByText("ork resume aaa11111 --detach").tagName,
    ).toBe("CODE");
    expect(
      within(dialog).getByRole("button", { name: /^Copy/u }),
    ).toBeDefined();
    expect(controlled).toEqual([]);
    expect(await violations(dialog)).toEqual([]);
    await user.click(
      within(dialog).getByRole("button", { name: "Resume run" }),
    );
    await vi.waitFor(() => {
      expect(controlled).toEqual([
        { kind: "resume", run: "aaa11111", body: {} },
      ]);
    });
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(
        document.querySelector('[data-run-heading="aaa11111"]'),
      );
    });
  });

  it("keeps a refusal in its dialog", async () => {
    const user = userEvent.setup();
    const { controlled } = await open(runView("aaa11111", "failed"), {
      ...ROUTES,
      refuse: "Run aaa11111 is still running.",
    });
    await user.click(resumeButton());
    const dialog = await screen.findByRole("alertdialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Resume run" }),
    );
    expect((await within(dialog).findByRole("alert")).textContent).toBe(
      "Could not resume the run: Run aaa11111 is still running.",
    );
    expect(controlled).toEqual([]);
  });

  it("works from the keyboard, and Escape gives the focus back", async () => {
    const user = userEvent.setup();
    const { controlled } = await open(runView("aaa11111", "failed"));
    resumeButton().focus();
    await user.keyboard("{Enter}");
    const dialog = await screen.findByRole("alertdialog");
    // The dialog takes the focus a tick after it shows; a busy suite can see
    // it in between.
    await vi.waitFor(() => {
      expect(dialog.contains(document.activeElement)).toBe(true);
    });
    await user.keyboard("{Escape}");
    await vi.waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(resumeButton());
    });
    expect(controlled).toEqual([]);
  });
});
