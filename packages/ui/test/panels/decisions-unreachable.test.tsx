/**
 * @file Tests for the Decisions panel while `ork ui` is unreachable: one
 *   notice, every option turned off (but still focusable) with its `ork decide`
 *   command on the page, no answer sent by a click or a key, and everything
 *   back when the server returns.
 */

import type { DecisionRecord } from "@krapht/ork-server/client";
import { act, cleanup, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DecisionsPanel } from "../../src/panels/decisions-panel.tsx";
import type { Connection } from "../../src/state/app-state.ts";
import { violations } from "../axe.ts";
import { stubWindow } from "../dom.ts";
import { runView } from "../state/fixtures.ts";
import { openPanelState, renderPanel } from "./harness.tsx";

const NOTICE =
  "Cannot answer here: ork ui is not reachable. Answer from a terminal with the command under each option.";

const OK: Connection = {
  link: "open",
  server: { version: "0.4.0", pid: 1, startedAt: "2026-11-03T00:00:00.000Z" },
};
const LOST: Connection = { link: "lost", server: null };
const REFUSED: Connection = { link: "open", server: { error: "No answer" } };

const decision: DecisionRecord = {
  id: "d1",
  runId: "aaa11111",
  node: "gate",
  kind: "question",
  question: "Merge d1?",
  options: [{ id: "merge", label: "Merge it" }, { id: "reject" }],
  recommended: "merge",
  openedAt: "2026-11-03T00:00:00.000Z",
  status: "open",
};

const open = async () => {
  const opened = openPanelState();
  renderPanel(opened.state, <DecisionsPanel />);
  await act(async () => {
    opened.overview.send("runs", [runView("aaa11111")]);
    opened.overview.send("decisions", [decision]);
    await Promise.resolve();
  });
  return opened;
};

const connect = async (
  state: Awaited<ReturnType<typeof open>>["state"],
  connection: Connection,
): Promise<void> => {
  await act(async () => {
    await state.connection.setValue(connection);
  });
};

const card = (): HTMLElement =>
  screen.getByRole("region", { name: /gate Merge d1\?$/u });
const options = (): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>("[data-option]"),
];
const notice = (): HTMLElement | null =>
  document.querySelector<HTMLElement>("[data-unreachable-notice]");

beforeEach(() => {
  localStorage.clear();
  stubWindow();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the Decisions panel when ork ui is unreachable", () => {
  it.each([
    ["the stream is lost", LOST],
    ["the health check fails", REFUSED],
  ])("turns the options off and says why when %s", async (_name, gone) => {
    const { state } = await open();
    await connect(state, gone);
    expect(notice()?.textContent).toBe(NOTICE);
    expect(options().map(o => o.getAttribute("aria-disabled"))).toEqual([
      "true",
      "true",
    ]);
    expect(options().map(o => Object.hasOwn(o.dataset, "unreachable"))).toEqual(
      [true, true],
    );
    expect(
      within(card()).getByText("ork decide aaa11111 --id d1 --choose reject"),
    ).toBeDefined();
  });

  it("sends nothing for a click, a digit or Enter", async () => {
    const user = userEvent.setup();
    const { state, controlled } = await open();
    await connect(state, LOST);
    await user.click(within(card()).getByText("reject"));
    card().focus();
    await user.keyboard("1{Enter}");
    expect(controlled).toEqual([]);
  });

  it("shows a typed note in the commands", async () => {
    const user = userEvent.setup();
    const { state } = await open();
    await connect(state, LOST);
    await user.type(within(card()).getByRole("textbox"), "ship it");
    expect(
      within(card()).getByText(/--choose reject --say .*ship it/u),
    ).toBeDefined();
  });

  it("keeps the focus where it was", async () => {
    const { state } = await open();
    const [first] = options();
    first?.focus();
    await connect(state, LOST);
    expect(document.activeElement).toBe(first);
  });

  it("has no live region of its own, for the status bar says it", async () => {
    const { state } = await open();
    await connect(state, LOST);
    expect(notice()?.getAttribute("role")).toBeNull();
    expect(notice()?.getAttribute("aria-live")).toBeNull();
  });

  it("passes axe", async () => {
    const { state } = await open();
    await connect(state, LOST);
    await expect(violations(document.body)).resolves.toEqual([]);
  });

  it("answers again when the server is back", async () => {
    const user = userEvent.setup();
    const { state, controlled } = await open();
    await connect(state, LOST);
    await connect(state, OK);
    expect(notice()).toBeNull();
    await user.click(within(card()).getByText("reject"));
    expect(controlled).toEqual([
      { kind: "answer", run: "d1", body: { choose: "reject" } },
    ]);
  });
});
