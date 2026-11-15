/**
 * @file Tests for the Logs panel on a run that has ended: Follow reads as off,
 *   and its command has no `--follow`, as there is nothing live to follow.
 */

import type { StoredEvent } from "@krapht/ork-server/client";
import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LogsPanel } from "../../src/panels/logs-panel.tsx";
import { stubWindow } from "../dom.ts";
import { runView } from "../state/fixtures.ts";
import { openPanelState, renderPanel } from "./harness.tsx";

const EVENTS: StoredEvent[] = [
  {
    runId: "r",
    seq: 1,
    at: "2026-11-15T10:00:00.000Z",
    event: { type: "edge.taken", from: "first", to: "last" },
  },
];

beforeEach(() => {
  localStorage.clear();
  stubWindow();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the Logs panel on an ended run", () => {
  it("shows Follow off, and no --follow, for a run that has ended", async () => {
    const opened = openPanelState({ events: EVENTS });
    renderPanel(opened.state, <LogsPanel />);
    await act(async () => {
      opened.overview.send("runs", [runView("r", "crashed")]);
      opened.state.selectRun("r");
      await Promise.resolve();
    });
    await screen.findByRole("list", { name: "Events of run r" });
    const follow = screen.getByRole("button", { name: /^Follow/u });
    expect(follow.getAttribute("aria-pressed")).toBe("false");
    expect(follow.getAttribute("aria-description")).toBe("CLI: ork logs r");
  });
});
