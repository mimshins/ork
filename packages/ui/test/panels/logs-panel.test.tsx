/**
 * @file Tests for the Logs panel on a fake server: it follows the chosen run,
 *   filters by node, type and text, opens an event, moves with the keys, holds
 *   and follows, and shows the command.
 */

import type { StoredEvent } from "@krapht/ork-server/client";
import {
  act,
  cleanup,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LogsPanel } from "../../src/panels/logs-panel.tsx";
import { createWorkspace } from "../../src/workspace/workspace.ts";
import { violations } from "../axe.ts";
import { stubWindow } from "../dom.ts";
import { openPanelState, renderPanel } from "./harness.tsx";

const at = "2026-11-03T00:00:00.000Z";

const EVENTS: StoredEvent[] = [
  {
    runId: "r",
    seq: 1,
    at,
    event: {
      type: "node.started",
      id: "first",
      nodeType: "tool.shell",
      round: 1,
    },
  },
  {
    runId: "r",
    seq: 2,
    at,
    event: { type: "edge.taken", from: "first", to: "last" },
  },
  {
    runId: "r",
    seq: 3,
    at,
    event: {
      type: "node.event",
      id: "last",
      event: { type: "assistant.text", text: "Needle  here" },
    },
  },
];

const open = async () => {
  const opened = openPanelState({ events: EVENTS });
  renderPanel(opened.state, <LogsPanel />);
  await act(async () => {
    opened.state.selectRun("r");
    await Promise.resolve();
  });
  await screen.findByRole("list", { name: "Events of run r" });
  return opened;
};

const rows = (): HTMLElement[] =>
  within(screen.getByRole("list", { name: "Events of run r" })).getAllByRole(
    "button",
  );

const filterBy = async (label: string, value: string): Promise<void> => {
  const user = userEvent.setup();
  await user.click(screen.getByLabelText(label));
  await user.keyboard(`${value}{Enter}`);
};

beforeEach(() => {
  localStorage.clear();
  stubWindow();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the Logs panel, for assistive tech", () => {
  it("says what the filters leave once typing stops", async () => {
    const workspace = createWorkspace({ storage: localStorage, wide: true });
    const opened = openPanelState({ events: EVENTS });
    renderPanel(opened.state, <LogsPanel />, workspace);
    await act(async () => {
      opened.state.selectRun("r");
      await Promise.resolve();
    });
    await screen.findByRole("list", { name: "Events of run r" });
    expect(workspace.announcement.getValue()).toBe("");
    await userEvent.type(screen.getByLabelText("Text"), "needle");
    await vi.waitFor(() => {
      expect(workspace.announcement.getValue()).toBe("1 of 3 loaded");
    });
  });

  it("lets the keys reach and scroll an opened event", async () => {
    await open();
    await userEvent.click(
      screen.getByRole("button", { name: /node\.started/u }),
    );
    const detail = screen.getByRole("group", { name: "Event 1 in full" });
    expect(detail.tabIndex).toBe(0);
  });
});

describe("the Logs panel", () => {
  it("asks for a run when none is chosen", () => {
    const { state } = openPanelState({});
    renderPanel(state, <LogsPanel />);
    expect(screen.getByText("No run chosen.")).toBeDefined();
  });

  it("lists the run's events, each with its node, type and a line", async () => {
    await open();
    expect(rows()).toHaveLength(3);
    expect(rows()[1]?.textContent).toContain("first");
    expect(rows()[1]?.textContent).toContain("edge.taken");
    expect(rows()[1]?.textContent).toContain("first -> last");
    expect(rows()[2]?.textContent).toContain("Needle here");
  });

  it("filters by node, and follows the shared selection", async () => {
    const { state } = await open();
    await act(async () => {
      state.selectNode("last");
      await Promise.resolve();
    });
    expect(rows()).toHaveLength(1);
    await act(async () => {
      state.selectNode(null);
      await Promise.resolve();
    });
    expect(rows()).toHaveLength(3);
    await filterBy("Node", "first");
    expect(state.selection.getValue().node).toBe("first");
    expect(rows()).toHaveLength(2);
  });

  it("filters by event type", async () => {
    await open();
    await filterBy("Event", "edge");
    expect(rows()).toHaveLength(1);
    expect(rows()[0]?.textContent).toContain("edge.taken");
  });

  it("filters by text anywhere in the event, and says when nothing matches", async () => {
    const user = userEvent.setup();
    await open();
    await user.type(screen.getByLabelText("Text"), "needle");
    expect(rows()).toHaveLength(1);
    expect(screen.getByText("1 of 3 loaded")).toBeDefined();
    await user.type(screen.getByLabelText("Text"), "zzz");
    expect(screen.getByText("No event matches.")).toBeDefined();
  });

  it("opens an event in full", async () => {
    const user = userEvent.setup();
    await open();
    expect(rows()[1]?.getAttribute("aria-expanded")).toBe("false");
    await user.click(screen.getByText("first -> last"));
    expect(rows()[1]?.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(/"to": "last"/u)).toBeDefined();
  });

  it("is one tab stop, and the keys move through it", async () => {
    const user = userEvent.setup();
    await open();
    const tabbable = rows().filter(row => row.tabIndex === 0);
    expect(tabbable).toEqual([rows()[2]]);
    rows()[2]?.focus();
    await user.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(rows()[1]);
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(rows()[0]);
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(rows()[2]);
    expect(rows()[2]?.tabIndex).toBe(0);
  });

  it("holds when scrolled up, and follows again from the button", async () => {
    const user = userEvent.setup();
    const { state } = await open();
    const list = screen.getByRole("list", { name: "Events of run r" });
    Object.defineProperty(list, "scrollHeight", { value: 1000 });
    Object.defineProperty(list, "clientHeight", { value: 100 });
    list.scrollTop = 100;
    fireEvent.scroll(list);
    const follow = screen.getByRole("button", { name: /^Follow/u });
    expect(follow.getAttribute("aria-pressed")).toBe("false");
    await user.click(follow);
    await vi.waitFor(() => {
      expect(state.feedOf("r").state.getValue().following).toBe(true);
    });
  });

  it("gives the command that shows the same", async () => {
    const { state } = await open();
    await act(async () => {
      state.selectNode("last");
      await Promise.resolve();
    });
    expect(
      screen
        .getByRole("button", { name: /^Follow/u })
        .getAttribute("aria-description"),
    ).toBe("CLI: ork logs r --node last --follow");
  });

  it("has nothing for axe to find", async () => {
    await open();
    await expect(violations(document.body)).resolves.toEqual([]);
  });
});
