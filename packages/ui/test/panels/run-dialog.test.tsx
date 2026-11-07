/**
 * @file Tests for the Run workflow dialog: it picks what has only one choice,
 *   shows a workflow's inputs and its CLI twin, keeps Start disabled with the
 *   reason, starts the run and selects it, sends the focus to the run where it
 *   shows, and keeps the server's refusal.
 */

import { act, cleanup, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MonitorPanel } from "../../src/panels/monitor-panel.tsx";
import { RunDialog } from "../../src/panels/run-dialog.tsx";
import { RunsPanel } from "../../src/panels/runs-panel.tsx";
import { violations } from "../axe.ts";
import { stubWindow } from "../dom.ts";
import { runView } from "../state/fixtures.ts";
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

/** The dialog beside the Runs panel, opened by the palette, not the panel. */
const openWithRuns = async () => {
  const opened = openPanelState(ONE);
  renderPanel(
    opened.state,
    <>
      <RunDialog />
      <RunsPanel />
    </>,
  );
  await act(async () => {
    opened.overview.send("runs", []);
    opened.overview.send("decisions", []);
    await opened.state.runDialog.setValue(true);
  });
  return opened;
};

/** Fills in what `build` needs, and starts it. */
const startBuild = async () => {
  await userEvent.type(await screen.findByLabelText(/^feature/u), "csv");
  await userEvent.click(startButton());
};

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

  it("says what to type, and holds the workflow back until there is a project", async () => {
    await open({ projects: [project("shop"), project("blog")] });
    const projectField = await screen.findByLabelText("Project");
    expect(projectField.getAttribute("placeholder")).toBe(
      "Type to find a project",
    );
    const workflowField = screen.getByLabelText("Workflow");
    expect(workflowField.getAttribute("placeholder")).toBe(
      "Choose a project first",
    );
    expect(isDisabled(workflowField)).toBe(true);
  });

  it("finds a project by typing, and takes the first match with Enter", async () => {
    const user = userEvent.setup();
    await open({
      projects: [project("shop"), project("blog")],
      workflows: {
        blog: [workflowNamed("post", {}), workflowNamed("edit", {})],
      },
    });
    await user.click(await screen.findByLabelText("Project"));
    await user.keyboard("bl");
    expect(await screen.findByRole("option", { name: "blog" })).toBeDefined();
    expect(screen.queryByRole("option", { name: "shop" })).toBeNull();
    await user.keyboard("{Enter}");
    expect(screen.getByLabelText<HTMLInputElement>("Project").value).toBe(
      "blog",
    );
    await screen.findByText("Pick a workflow.");
    expect(isDisabled(screen.getByLabelText("Workflow"))).toBe(false);
  });

  it("says when a project has no workflows", async () => {
    await open({ projects: [project("shop")], workflows: { shop: [] } });
    expect(
      await screen.findByText(
        "shop has no workflows. Add one to its .ork/workflows folder.",
      ),
    ).toBeDefined();
    expect(screen.getByLabelText("Workflow").getAttribute("placeholder")).toBe(
      "No workflows here",
    );
  });

  it("names the list and its input while it is open", async () => {
    await open();
    const input = await screen.findByRole("combobox", { name: "Workflow" });
    expect(input.getAttribute("aria-label")).toBe("Workflow");
    await userEvent.click(
      screen.getByRole("button", { name: "Show Workflow list" }),
    );
    expect(
      await screen.findByRole("listbox", { name: "Workflow" }),
    ).toBeDefined();
  });

  it("goes to the new run's heading if the Monitor shows one", async () => {
    const { state } = await open();
    const heading = document.createElement("h2");
    heading.dataset["runHeading"] = "new11111";
    heading.tabIndex = -1;
    document.body.append(heading);
    await userEvent.type(await screen.findByLabelText(/^feature/u), "csv");
    await userEvent.click(startButton());
    await waitFor(() => {
      expect(state.runDialog.getValue()).toBe(false);
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(heading);
    });
    heading.remove();
  });

  it("goes to the new run's heading when it shows after the dialog closed", async () => {
    const opened = openPanelState({
      ...ONE,
      monitor: {
        graph: { nodes: [], edges: [], channels: [] },
        tree: [],
      },
    });
    renderPanel(
      opened.state,
      <>
        <RunDialog />
        <MonitorPanel />
      </>,
    );
    await act(async () => {
      opened.overview.send("runs", []);
      opened.overview.send("decisions", []);
      await opened.state.runDialog.setValue(true);
    });
    await userEvent.type(await screen.findByLabelText(/^feature/u), "csv");
    await userEvent.click(startButton());
    await waitFor(() => {
      expect(opened.state.runDialog.getValue()).toBe(false);
    });
    await act(async () => {
      opened.overview.send("runs", [runView("new11111")]);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(
        document.querySelector('[data-run-heading="new11111"]'),
      );
    });
  });

  it("goes to the Runs panel with no Monitor showing the new run", async () => {
    const opened = await openWithRuns();
    await startBuild();
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Run workflow" }),
      );
    });
    expect(opened.state.runDialog.getValue()).toBe(false);
  });

  it("goes to the new run's row if the Runs panel lists it already", async () => {
    const opened = await openWithRuns();
    await act(async () => {
      opened.overview.send("runs", [runView("new11111")]);
      await Promise.resolve();
    });
    await startBuild();
    await waitFor(() => {
      expect(document.activeElement).toBe(
        document.querySelector('[data-run-row="new11111"]'),
      );
    });
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
