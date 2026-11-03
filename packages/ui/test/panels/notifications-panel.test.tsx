/**
 * @file Tests for the Notifications panel and its bell: it lists what happened,
 *   says what is unread, marks it read, goes to the run, and asks the browser
 *   before turning on desktop notifications.
 */

import type { DecisionRecord } from "@krapht/ork-server/client";
import { act, cleanup, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NotificationsPanel } from "../../src/panels/notifications-panel.tsx";
import { violations } from "../axe.ts";
import { stubWindow } from "../dom.ts";
import { runView } from "../state/fixtures.ts";
import { openPanelState, renderPanel } from "./harness.tsx";

const decision: DecisionRecord = {
  id: "d1",
  runId: "aaa11111",
  node: "gate",
  kind: "question",
  question: "Ship?",
  options: [],
  openedAt: "2026-11-03T02:00:00.000Z",
  status: "open",
};

const open = async (decisions: DecisionRecord[] = [decision]) => {
  const opened = openPanelState({});
  renderPanel(opened.state, <NotificationsPanel />);
  await act(async () => {
    opened.overview.send("runs", [runView("aaa11111")]);
    opened.overview.send("decisions", decisions);
    await Promise.resolve();
  });
  return opened;
};

const NAME = "gate in run aaa11111 asks: Ship?";

const stubNotification = (answer: string) => {
  const requestPermission = vi.fn<() => Promise<string>>(() =>
    Promise.resolve(answer),
  );
  vi.stubGlobal("Notification", { permission: "default", requestPermission });
  return requestPermission;
};

beforeEach(() => {
  localStorage.clear();
  stubWindow();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the Notifications panel", () => {
  it("says when there is nothing", async () => {
    await open([]);
    expect(screen.getByText("Nothing yet.")).toBeDefined();
    expect(
      screen
        .getByRole("button", { name: "Mark all read" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("moves the focus to the next item when the focused one goes", async () => {
    const other = { ...decision, id: "d2", question: "Merge?" };
    const { overview } = await open([decision, other]);
    screen.getByRole("button", { name: `Mark read: ${NAME}` }).focus();
    await act(async () => {
      overview.send("decisions", [other]);
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(document.activeElement).not.toBe(document.body);
    });
    expect(
      document.activeElement?.closest("[data-notification]"),
    ).not.toBeNull();
  });

  it("lists an item, and says it is unread in a word", async () => {
    await open();
    expect(screen.getByText(NAME)).toBeDefined();
    expect(screen.getByText("unread")).toBeDefined();
  });

  it("marks one read, keeping the focus on its button", async () => {
    const user = userEvent.setup();
    await open();
    const button = screen.getByRole("button", { name: `Mark read: ${NAME}` });
    await user.click(button);
    expect(screen.queryByText("unread")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("marks all read", async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole("button", { name: "Mark all read" }));
    expect(screen.queryByText("unread")).toBeNull();
  });

  it("goes to the run and the node, and counts it read", async () => {
    const user = userEvent.setup();
    const { state } = await open();
    await user.click(screen.getByRole("button", { name: `Open: ${NAME}` }));
    expect(state.selection.getValue()).toEqual({
      run: "aaa11111",
      node: "gate",
    });
    expect(screen.queryByText("unread")).toBeNull();
  });

  it("asks the browser before turning desktop notifications on", async () => {
    const user = userEvent.setup();
    const asked = stubNotification("granted");
    const { state } = await open();
    await user.click(
      screen.getByRole("switch", { name: "Desktop notifications" }),
    );
    expect(asked).toHaveBeenCalledOnce();
    await vi.waitFor(() => {
      expect(state.preferences.value.getValue().desktopNotifications).toBe(
        true,
      );
    });
  });

  it("stays off, and says so, when the browser refuses", async () => {
    const user = userEvent.setup();
    stubNotification("denied");
    const { state } = await open();
    await user.click(
      screen.getByRole("switch", { name: "Desktop notifications" }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain("refused");
    expect(state.preferences.value.getValue().desktopNotifications).toBe(false);
  });

  it("has nothing for axe to find", async () => {
    await open();
    await expect(violations(document.body)).resolves.toEqual([]);
  });
});
