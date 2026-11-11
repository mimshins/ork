/**
 * @file Tests for a node's `model` in the builder: a driver-prefixed model says
 *   where it runs, a prefix that contradicts the node's `driver` is an error,
 *   and a plain or templated model says nothing of a driver (RFC-015).
 */

import { cleanup, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BuilderPanel } from "../../src/builder/builder-panel.tsx";
import { modelClash, modelHint } from "../../src/builder/model-driver.ts";
import { stubWindow } from "../dom.ts";
import {
  openPanelState,
  project,
  renderPanel,
  workflowNamed,
} from "../panels/harness.tsx";
import { fakeWorkflows } from "./fake-workflows.ts";

const agentText = (fields: string): string =>
  `schemaVersion: 1\nname: a\nnodes:\n  n:\n    type: agent.worker\n    prompt: hi\n${fields}`;

/** Opens the workflow `a` with one agent node `n` and selects the node. */
const openAgent = async (fields: string) => {
  const fake = fakeWorkflows();
  const { a } = fake.files;
  if (a !== undefined) a.text = agentText(fields);
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
  await user.click(await screen.findByRole("button", { name: /^n,/u }));
  await screen.findByRole("textbox", { name: "Model" });
};

beforeEach(() => {
  localStorage.clear();
  stubWindow();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("what a model says of its driver", () => {
  it.each([
    ["claude-code.sonnet", "Runs on claude-code."],
    ["open-code.anthropic/claude-sonnet-5-5", "Runs on open-code."],
    ["command-code.deepseek/deepseek-v4.1-flash", "Runs on command-code."],
  ])("hints where %s runs", (model, says) => {
    expect(modelHint(model)).toContain(says);
  });

  it.each([
    ["sonnet"],
    ["deepseek/deepseek-v4.1-flash"],
    ["{{item.model}}"],
    ["{{item.claude-code.model}}"],
    [null],
  ])("hints no driver for %s", model => {
    expect(modelHint(model)).not.toContain("Runs on");
  });

  it("keeps the hint it was given", () => {
    expect(modelHint("claude-code.opus", "Mine.")).toBe(
      "Mine. Runs on claude-code.",
    );
  });

  it.each([
    ["claude-code.opus", "open-code", true],
    ["claude-code.opus", "claude-code", false],
    ["claude-code.opus", null, false],
    ["opus", "open-code", false],
    ["{{item.model}}", "open-code", false],
  ])("flags %s on driver %s: %s", (model, driver, flagged) => {
    expect(modelClash(model, driver) !== undefined).toBe(flagged);
  });
});

describe("a node's model field", () => {
  it("says where a prefixed model runs", async () => {
    await openAgent("    model: command-code.deepseek/deepseek-v4.1-flash\n");
    expect(await screen.findByText(/Runs on command-code\./u)).toBeDefined();
    expect(screen.queryByText(/contradicts|Make them match/u)).toBeNull();
  });

  it("teaches the form for a plain model", async () => {
    await openAgent("    model: sonnet\n");
    expect(await screen.findByText(/<driver>\.<model>/u)).toBeDefined();
    expect(screen.queryByText(/Runs on/u)).toBeNull();
  });

  it("flags a prefix that is not the node's driver", async () => {
    await openAgent("    model: claude-code.opus\n    driver: open-code\n");
    expect(
      await screen.findByText(/Model names claude-code.*open-code/u),
    ).toBeDefined();
  });

  it("leaves a model that matches the node's driver alone", async () => {
    await openAgent("    model: claude-code.opus\n    driver: claude-code\n");
    expect(await screen.findByText(/Runs on claude-code\./u)).toBeDefined();
    expect(screen.queryByText(/Make them match/u)).toBeNull();
  });
});
