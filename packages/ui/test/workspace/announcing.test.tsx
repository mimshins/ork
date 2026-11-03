/**
 * @file Tests that a panel's announcement reaches the status bar's live region
 *   in the real shell, including stacked on a narrow screen, where there is no
 *   dock around the panels.
 */

import type { RunView } from "@krapht/ork-server/client";
import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Shell } from "../../src/workspace/shell.tsx";
import { createWorkspace } from "../../src/workspace/workspace.ts";
import { stubWindow } from "../dom.ts";
import { openPanelState, renderPanel } from "../panels/harness.tsx";
import { treeNode } from "../panels/monitor-fixtures.ts";
import { runView } from "../state/fixtures.ts";

const RUN = runView("aaa11111");
const PAUSED: RunView = { ...RUN, live: "paused" };

beforeEach(() => {
  localStorage.clear();
  stubWindow();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("announcing from a panel", () => {
  it("reaches the live region when the panels are stacked", async () => {
    const workspace = createWorkspace({ storage: localStorage, wide: false });
    const { state, overview } = openPanelState({
      monitor: {
        graph: {
          nodes: [{ id: "lead", type: "claude.leader" }],
          edges: [],
          channels: [],
          positions: {},
        },
        tree: [treeNode("lead", { type: "claude.leader", state: "running" })],
      },
    });
    const { container } = renderPanel(state, <Shell workspace={workspace} />);
    await act(async () => {
      overview.send("runs", [PAUSED]);
      overview.send("decisions", []);
      state.selectRun(RUN.id);
      await Promise.resolve();
    });
    await screen.findByRole("treeitem", { name: /^lead,/u });
    await act(async () => {
      overview.send("runs", [RUN]);
      await Promise.resolve();
    });
    await vi.waitFor(
      () => {
        expect(
          container.querySelector('footer output[aria-live="polite"]')
            ?.textContent,
        ).toBe("Run aaa11111 running.");
      },
      { timeout: 3000 },
    );
  });

  it("says a new notification, and not what was there on opening", async () => {
    const workspace = createWorkspace({ storage: localStorage, wide: false });
    const { state, overview } = openPanelState({});
    const { container } = renderPanel(state, <Shell workspace={workspace} />);
    const live = (): string | null | undefined =>
      container.querySelector('footer output[aria-live="polite"]')?.textContent;
    await act(async () => {
      overview.send("runs", [runView("old11111", "failed")]);
      overview.send("decisions", []);
      await Promise.resolve();
    });
    expect(live()).toBe("");
    await act(async () => {
      overview.send("runs", [
        runView("new11111", "failed"),
        runView("old11111", "failed"),
      ]);
      await Promise.resolve();
    });
    expect(live()).toContain("Run new11111");
    expect(live()).toContain("failed.");
  });
});
