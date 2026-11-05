/**
 * @file Tests for the workflow builder panel, against the real document edits
 *   and the real draft graph behind a fake server: a person can build a
 *   workflow from nothing with no YAML, errors block saving and say where they
 *   are, and a run names what acts outside its worktree first.
 */

import { parseWorkflow } from "@krapht/ork-server";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BuilderPanel } from "../../src/builder/builder-panel.tsx";
import { RunDialog } from "../../src/panels/run-dialog.tsx";
import { violations } from "../axe.ts";
import { stubWindow } from "../dom.ts";
import {
  openPanelState,
  project,
  renderPanel,
  workflowNamed,
} from "../panels/harness.tsx";
import { fakeBuilder } from "./fake-builder.ts";

const open = async () => {
  const fake = fakeBuilder();
  const opened = openPanelState({
    projects: [project("shop")],
    workflows: { shop: [workflowNamed("fresh")] },
    builder: fake.routes,
  });
  const drawn = renderPanel(
    opened.state,
    <>
      <BuilderPanel />
      <RunDialog />
    </>,
  );
  await screen.findByLabelText("New workflow");
  await waitFor(() => {
    expect(
      screen.getByRole<HTMLInputElement>("combobox", { name: "Project" }).value,
    ).toBe("shop");
  });
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("New workflow"), "fresh");
  await user.click(screen.getByRole("button", { name: "Create" }));
  await screen.findByRole("navigation", { name: "Add a node" });
  await screen.findByRole("button", { name: "worker" });
  return { ...opened, ...fake, user, drawn };
};

const addNode = async (
  user: ReturnType<typeof userEvent.setup>,
  name: string,
  id: string,
) => {
  await user.click(screen.getByRole("button", { name }));
  await screen.findByRole("button", { name: new RegExp(`^${id},`, "u") });
};

beforeEach(() => {
  localStorage.clear();
  stubWindow();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the builder", () => {
  it("says what to do before anything is open", async () => {
    const opened = openPanelState({
      projects: [project("shop")],
      builder: fakeBuilder().routes,
    });
    renderPanel(opened.state, <BuilderPanel />);
    expect(await screen.findByText("No workflow open.")).toBeDefined();
  });

  it("builds a valid workflow from nothing, and saves it", async () => {
    const { user, held } = await open();
    expect(screen.getByText("No nodes yet.")).toBeDefined();
    await addNode(user, "worker", "worker");
    await user.type(await screen.findByLabelText("Prompt"), "Do the work.");
    await user.tab();
    await waitFor(() => {
      expect(held.text).toContain("prompt: Do the work.");
    });
    await addNode(user, "shell tool", "shell");
    await user.click(screen.getByRole("button", { name: /^worker,/u }));
    await user.click(await screen.findByRole("button", { name: "Connect" }));
    await waitFor(() => {
      expect(held.text).toContain("worker -> shell");
    });
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(held.saved).toBe(true);
    });
    expect(parseWorkflow(held.text).ok).toBe(true);
  }, 20_000);

  it("says what walking it came to, with no problem to list", async () => {
    const { user } = await open();
    await addNode(user, "worker", "worker");
    expect(
      await screen.findByText(
        "No problems found. Walked 2 ways through: 1 succeeds, 1 fails.",
      ),
    ).toBeDefined();
  }, 20_000);

  it("blocks saving on errors, and takes a person to them", async () => {
    const { user } = await open();
    await addNode(user, "gate", "gate");
    const save = screen.getByRole("button", { name: "Save" });
    expect(save.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText("Fix these before saving")).toBeDefined();
    const problem = screen
      .getAllByRole("button")
      .find(button => button.textContent.startsWith("gate:"));
    expect(problem).toBeDefined();
    expect(
      screen.getByRole("button", { name: /^gate, \d+ errors?/u }),
    ).toBeDefined();
  }, 20_000);

  it("undoes an edit, and follows a rename", async () => {
    const { user, held } = await open();
    await addNode(user, "worker", "worker");
    const name = await screen.findByLabelText("Name");
    await user.clear(name);
    await user.type(name, "builder");
    await user.tab();
    await waitFor(() => {
      expect(held.text).toContain("builder:");
    });
    await screen.findByRole("button", { name: /^builder,/u });
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => {
      expect(held.text).not.toContain("builder:");
    });
  }, 20_000);

  it("says a refusal, and keeps the node's name", async () => {
    const { user } = await open();
    await addNode(user, "worker", "worker");
    await addNode(user, "shell tool", "shell");
    const name = await screen.findByLabelText("Name");
    await user.clear(name);
    await user.type(name, "worker");
    await user.tab();
    expect((await screen.findByRole("alert")).textContent).toContain(
      "already a node",
    );
    await waitFor(() => {
      expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe(
        "shell",
      );
    });
  }, 20_000);

  it("connects by picking a card, with no drag", async () => {
    const { user, held } = await open();
    await addNode(user, "worker", "worker");
    await addNode(user, "shell tool", "shell");
    await user.click(screen.getByRole("button", { name: "Pick a card" }));
    expect(screen.getByText("Choose the card shell leads to.")).toBeDefined();
    await user.click(screen.getByRole("button", { name: /^worker,/u }));
    await waitFor(() => {
      expect(held.text).toContain("shell -> worker");
    });
  }, 20_000);

  it("names what acts outside the worktree before a real run", async () => {
    const { user, state } = await open();
    await addNode(user, "gh tool", "gh");
    await user.type(await screen.findByLabelText(/Command/u), "pr create");
    await user.tab();
    await waitFor(() => {
      expect(
        screen
          .getByRole("button", { name: "Run…" })
          .getAttribute("aria-disabled"),
      ).not.toBe("true");
    });
    await user.click(screen.getByRole("button", { name: "Run…" }));
    const asked = await screen.findByRole("alertdialog");
    expect(asked.textContent).toContain("real run");
    expect(asked.textContent).toContain("gh (tool.gh)");
    await user.click(
      screen.getByRole("button", { name: "Choose how to run it" }),
    );
    await waitFor(() => {
      expect(state.runDialog.getValue()).toBe(true);
    });
    expect(state.runPreset.getValue()).toEqual({
      project: "shop",
      workflow: "fresh",
    });
  }, 20_000);

  it("has no accessibility problems", async () => {
    const { user, drawn } = await open();
    await addNode(user, "worker", "worker");
    await addNode(user, "gate", "gate");
    await act(async () => {
      await Promise.resolve();
    });
    expect(await violations(drawn.container)).toEqual([]);
  }, 20_000);
});
