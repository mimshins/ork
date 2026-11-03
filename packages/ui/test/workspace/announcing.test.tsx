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
      overview.send("runs", [RUN]);
      overview.send("decisions", []);
      state.selectRun(RUN.id);
      await Promise.resolve();
    });
    await screen.findByRole("treeitem", { name: /^lead,/u });
    const paused: RunView = { ...RUN, live: "paused" };
    await act(async () => {
      overview.send("runs", [paused]);
      await Promise.resolve();
    });
    await vi.waitFor(
      () => {
        expect(
          container.querySelector('footer output[aria-live="polite"]')
            ?.textContent,
        ).toBe("Run aaa11111 paused.");
      },
      { timeout: 3000 },
    );
  });
});
