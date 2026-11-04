/**
 * @file Tests for an edge's condition as choices in the panel (RFC-010),
 *   against the real document edits: what's chosen is what the file says.
 */

import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BuilderPanel } from "../../src/builder/builder-panel.tsx";
import { stubWindow } from "../dom.ts";
import {
  openPanelState,
  project,
  renderPanel,
  workflowNamed,
} from "../panels/harness.tsx";
import { fakeWorkflows } from "./fake-workflows.ts";

const TEXT = `schemaVersion: 1
name: a
nodes:
  build:
    type: claude.worker
  pr:
    type: tool.gh
    command: pr view
    output:
      format: json
  ask:
    type: human.gate
    question: Ship?
    options: [ship, keep]
  done:
    type: tool.shell
    command: x
edges:
  - build -> done
  - { from: pr, to: done, when: "json.state == 'OPEN'" }
  - { from: ask, to: done, when: "choice == 'ship'" }
`;

const open = async (id: string, text = TEXT) => {
  const fake = fakeWorkflows();
  const { a } = fake.files;
  if (a !== undefined) a.text = text;
  const opened = openPanelState({
    projects: [project("shop")],
    workflows: { shop: [workflowNamed("a")] },
    builder: fake.routes,
  });
  renderPanel(opened.state, <BuilderPanel />);
  await screen.findByLabelText("New workflow");
  const user = userEvent.setup();
  await waitFor(() => {
    expect(
      screen.getByRole<HTMLInputElement>("combobox", { name: "Project" }).value,
    ).toBe("shop");
  });
  await user.click(await screen.findByRole("combobox", { name: "Workflow" }));
  await user.click(await screen.findByRole("option", { name: /^a/u }));
  await screen.findByRole("navigation", { name: "Add a node" });
  await user.click(
    await screen.findByRole("button", { name: new RegExp(`^${id},`, "u") }),
  );
  const edges = await screen.findByRole("region", { name: `Edges of ${id}` });
  return { user, edges, text: (): string => fake.files["a"]?.text ?? "" };
};

const choose = async (
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  option: string,
) => {
  await user.click(screen.getByRole("combobox", { name: label }));
  await user.click(await screen.findByRole("option", { name: option }));
};

beforeEach(() => {
  stubWindow();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("a condition as choices", () => {
  it("writes a test from a field, a test and a listed value", async () => {
    const { user, text } = await open("build");
    await choose(user, "Follow this edge, to done", "When a test holds");
    await waitFor(() => {
      expect(text()).toContain("when: status == 'pass'");
    });
    await choose(user, "Value, to done", "changes_requested");
    await waitFor(() => {
      expect(text()).toContain("when: status == 'changes_requested'");
    });
    await choose(user, "Test, to done", "isn't");
    await waitFor(() => {
      expect(text()).toContain("when: status != 'changes_requested'");
    });
  });

  it("offers only the values the node can say", async () => {
    const { user } = await open("ask");
    await user.click(screen.getByRole("combobox", { name: "Value, to done" }));
    const list = await screen.findByRole("listbox");
    expect(
      within(list)
        .getAllByRole("option")
        .map(option => option.textContent),
    ).toEqual(["ship", "keep"]);
  });

  it("writes a failure that any node can have", async () => {
    const { user, text } = await open("build");
    await choose(user, "Follow this edge, to done", "When it fails");
    await waitFor(() => {
      expect(text()).toContain('when: "!ok"');
    });
  });

  it("takes the condition off again", async () => {
    const { user, text } = await open("ask");
    await choose(user, "Follow this edge, to done", "Whatever the answer");
    await waitFor(() => {
      expect(text()).not.toContain("choice ==");
    });
  });

  it("says which of a gate's answers ends the run", async () => {
    const { edges } = await open("ask");
    expect(
      within(edges).getByText("Answering keep ends the run here."),
    ).toBeTruthy();
  });

  it("keeps a condition it can't show as written, and can replace it", async () => {
    const { user, text } = await open("pr");
    expect(
      screen.getByLabelText<HTMLInputElement>("Condition, to done").value,
    ).toBe("json.state == 'OPEN'");
    await choose(user, "Follow this edge, to done", "When it succeeds");
    await waitFor(() => {
      expect(text()).not.toContain("json.state");
    });
  });

  it("declares a field and reads it, as one edit", async () => {
    const { user, text } = await open("pr");
    await user.click(
      screen.getByRole("button", { name: "Add a field, to done" }),
    );
    await user.type(screen.getByLabelText("New field, to done"), "state");
    await user.type(
      screen.getByLabelText("Its values, to done"),
      "OPEN, CLOSED",
    );
    await user.click(screen.getByRole("button", { name: "Add state" }));
    await waitFor(() => {
      expect(text()).toContain("- CLOSED");
    });
    expect(text()).toContain("json.state == 'OPEN'");
    expect(
      await screen.findByRole("combobox", { name: "Value, to done" }),
    ).toBeTruthy();
  });

  it("closes a loop with its condition and rounds, leaving nothing to refuse", async () => {
    const { user, text } = await open("done");
    await choose(user, "Connect to", "build");
    await act(async () => {
      await user.click(screen.getByRole("button", { name: "Connect" }));
    });
    await waitFor(() => {
      expect(text()).toContain("maxRounds: 3");
    });
    expect(
      screen.getByLabelText<HTMLInputElement>("Max rounds, to build").value,
    ).toBe("3");
  });
});
