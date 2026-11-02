/**
 * @file Tests for the Run workflow dialog: it picks what has only one choice,
 *   shows a workflow's inputs and its CLI twin, keeps Start disabled with the
 *   reason, starts the run and selects it, and keeps the server's refusal.
 */

import { act, cleanup, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RunDialog } from "../../src/panels/run-dialog.tsx";
import { violations } from "../axe.ts";
import { stubWindow } from "../dom.ts";
import {
  type FakeRoutes,
  openPanelState,
  project,
  renderPanel,
  workflowNamed,
} from "./harness.tsx";

const ONE: FakeRoutes = {
  projects: [project("shop")],
  workflows: {
    shop: [
      workflowNamed("build", {
        feature: { required: true, description: "What to build." },
      }),
    ],
  },
};

const open = async (routes: FakeRoutes = ONE) => {
  const opened = openPanelState(routes);
  renderPanel(opened.state, <RunDialog />);
  await act(async () => {
    await opened.state.runDialog.setValue(true);
  });
  return opened;
};

const startButton = () => screen.getByRole("button", { name: "Start run" });

const isDisabled = (element: HTMLElement): boolean =>
  element.hasAttribute("disabled") ||
  element.getAttribute("aria-disabled") === "true";

beforeEach(() => {
  localStorage.clear();
  stubWindow();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the Run workflow dialog", () => {
  it("picks the only project and workflow, and asks for what is required", async () => {
    await open();
    expect(await screen.findByLabelText(/^feature/u)).toBeDefined();
    expect(screen.getByText("What to build.")).toBeDefined();
    expect(screen.getByText("Fill in feature.")).toBeDefined();
    expect(isDisabled(startButton())).toBe(true);
  });

  it("has no accessibility violations", async () => {
    await open();
    await screen.findByLabelText(/^feature/u);
    expect(await violations(document.body)).toEqual([]);
  });

  it("asks which project when there are several", async () => {
    await open({ projects: [project("shop"), project("blog")] });
    expect(await screen.findByText("Pick a project.")).toBeDefined();
  });

  it("teaches the next step when there are no projects", async () => {
    await open({ projects: [] });
    expect(await screen.findByText("No projects yet.")).toBeDefined();
    expect(screen.getByText("ork init")).toBeDefined();
  });

  it("shows the command as it is filled in", async () => {
    await open();
    await userEvent.type(await screen.findByLabelText(/^feature/u), "csv");
    expect(
      screen.getByText("ork run build --detach --input feature=csv"),
    ).toBeDefined();
  });

  it("starts the run, selects it and closes, adding nothing to the list", async () => {
    const { state, started } = await open();
    await userEvent.type(await screen.findByLabelText(/^feature/u), "csv");
    await userEvent.click(startButton());
    await waitFor(() => {
      expect(state.runDialog.getValue()).toBe(false);
    });
    expect(started).toEqual([
      { project: "shop", workflow: "build", inputs: { feature: "csv" } },
    ]);
    expect(state.selection.getValue().run).toBe("new11111");
    expect(state.runs.getValue()).toBeNull();
    expect(await screen.findByText("Run new11111 started")).toBeDefined();
  });

  it("sends the flags the CLI would", async () => {
    const { started } = await open();
    await userEvent.type(await screen.findByLabelText(/^feature/u), "csv");
    await userEvent.click(screen.getByText(/^--in-place/u));
    await userEvent.click(screen.getByText(/^--allow-dirty/u));
    await userEvent.click(startButton());
    await waitFor(() => {
      expect(started).toHaveLength(1);
    });
    expect(started[0]).toMatchObject({ inPlace: true, allowDirty: true });
  });

  it("keeps the server's refusal, in its words, and stays open", async () => {
    const { state } = await open({ ...ONE, refuse: "Uncommitted skills." });
    await userEvent.type(await screen.findByLabelText(/^feature/u), "csv");
    await userEvent.click(startButton());
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Uncommitted skills.",
    );
    expect(state.runDialog.getValue()).toBe(true);
    expect(state.selection.getValue().run).toBeNull();
  });

  it("closes on Cancel", async () => {
    const { state } = await open();
    await userEvent.click(
      await screen.findByRole("button", { name: "Cancel" }),
    );
    expect(state.runDialog.getValue()).toBe(false);
  });
});
