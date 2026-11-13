/**
 * @file Tests for the Monitor's Outputs card: nothing while the run goes or
 *   when it declares none, a short value as a copy block, a longer one in a
 *   named well, a cut one with its note and command, an empty one, a refused
 *   read, and the tab order through the card.
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

const ROUTES = (run: RunView | string): MonitorRoutes => ({
  graph: {
    nodes: [{ id: "a", type: "agent.worker" }],
    edges: [],
    channels: [],
  },
  tree: [treeNode("a", { state: "ok" })],
  run,
});

const withOutputs = (
  live: RunView["live"],
  outputs?: RunView["outputs"],
): RunView => ({
  ...runView("aaa11111", live),
  ...(outputs === undefined ? {} : { outputs }),
});

const open = async (run: RunView | string, live: RunView["live"]) => {
  const opened = openPanelState({ monitor: ROUTES(run) });
  renderPanel(opened.state, <MonitorPanel />);
  await act(async () => {
    opened.overview.send("runs", [runView("aaa11111", live)]);
    opened.overview.send("decisions", []);
    opened.state.selectRun("aaa11111");
    await Promise.resolve();
  });
  await screen.findByRole("treeitem", { name: /^a,/u });
  return opened;
};

const card = () => screen.queryByRole("region", { name: "Outputs" });

beforeEach(() => {
  localStorage.clear();
  stubWindow();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the Outputs card", () => {
  it("is not there while the run goes", async () => {
    await open(
      withOutputs("running", [{ name: "url", text: "x", cut: false }]),
      "running",
    );
    expect(card()).toBeNull();
  });

  it("is not there when the run declares none", async () => {
    await open(withOutputs("succeeded"), "succeeded");
    expect(card()).toBeNull();
  });

  it("copies a short value, and shows a long one in a named well", async () => {
    await open(
      withOutputs("succeeded", [
        { name: "url", text: "https://x/pull/1", cut: false },
        { name: "leftOut", text: "#3 failed\n#4 changes", cut: false },
        { name: "note", text: "", cut: false },
      ]),
      "succeeded",
    );
    const outputs = await screen.findByRole("region", { name: "Outputs" });
    expect(
      within(outputs).getByRole("button", { name: "Copy url" }),
    ).toBeTruthy();
    const well = within(outputs).getByRole("region", {
      name: "Output leftOut",
    });
    expect(well.textContent).toBe("#3 failed\n#4 changes");
    expect(
      within(outputs).getByRole("button", { name: "Copy leftOut" }),
    ).toBeTruthy();
    expect(within(outputs).getByText("empty")).toBeTruthy();
    expect(within(outputs).queryByText(/^Cut at/u)).toBeNull();
    expect(
      within(outputs)
        .getAllByRole("button")
        .map(button => button.getAttribute("aria-label")),
    ).toEqual(["Copy url", "Copy leftOut"]);
  });

  it("says a value was cut and points at the full ones; passes axe", async () => {
    await open(
      withOutputs("failed", [
        { name: "doc", text: "line\n".repeat(5), cut: true },
      ]),
      "failed",
    );
    const outputs = await screen.findByRole("region", { name: "Outputs" });
    expect(within(outputs).getByText("(cut)")).toBeTruthy();
    expect(
      within(outputs).getByText(/^Cut at 20 lines or 2,000 characters/u),
    ).toBeTruthy();
    expect(
      within(outputs).getByRole("button", {
        name: "Copy ork logs aaa11111 --json",
      }),
    ).toBeTruthy();
    expect(await violations(document.body)).toEqual([]);
  });

  it("says the read was refused, and gives the command", async () => {
    await open("no such run", "succeeded");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "Could not read the outputs: no such run",
    );
    expect(
      screen.getByRole("button", { name: "Copy ork logs aaa11111" }),
    ).toBeTruthy();
  });

  it("tabs through each copy button and well in order", async () => {
    await open(
      withOutputs("succeeded", [
        { name: "url", text: "https://x/pull/1", cut: false },
        { name: "leftOut", text: "a\nb", cut: false },
      ]),
      "succeeded",
    );
    const outputs = await screen.findByRole("region", { name: "Outputs" });
    const url = within(outputs).getByRole("button", { name: "Copy url" });
    await userEvent.click(url);
    await userEvent.tab();
    expect(
      document.activeElement ===
        within(outputs).getByRole("button", { name: "Copy leftOut" }),
    ).toBe(true);
    await userEvent.tab();
    expect(document.activeElement).toBe(
      within(outputs).getByRole("region", { name: "Output leftOut" }),
    );
  });
});
