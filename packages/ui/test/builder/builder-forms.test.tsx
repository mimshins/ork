/**
 * @file Tests for the builder's forms on real files: a value the form doesn't
 *   fully understand survives, a quick click keeps what was just typed, and
 *   losing work always asks first.
 */

import { parseWorkflow } from "@krapht/ork-server";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
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
import { fakeWorkflows, workflowText } from "./fake-workflows.ts";

const openFile = async (more = "") => {
  const fake = fakeWorkflows();
  const { a } = fake.files;
  if (a !== undefined) a.text = workflowText("a", more);
  const opened = openPanelState({
    projects: [project("shop")],
    workflows: { shop: [workflowNamed("a"), workflowNamed("b")] },
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
  const text = (): string => fake.files["a"]?.text ?? "";
  return { ...fake, user, text };
};

type Opened = Awaited<ReturnType<typeof openFile>>;

const selectNode = async ({ user }: Opened) => {
  await user.click(await screen.findByRole("button", { name: /^n,/u }));
  await screen.findByLabelText("Name");
};

const addButton = (name: RegExp) =>
  screen.getByRole("button", { name, hidden: true });

const settle = (ms: number) =>
  act(async () => {
    await new Promise(resolve => {
      setTimeout(resolve, ms);
    });
  });

const nth = <T,>(items: readonly T[], at: number): T => {
  const item = items[at];
  if (item === undefined) throw new Error(`Nothing at ${String(at)}.`);
  return item;
};

const newName = () => screen.getByLabelText(/New name in environment/iu);

const inputOf = (body: string) => `inputs:\n  v:\n${body}`;

const holdEdits = ({ holds }: Opened, ms: number) => {
  holds.push({ match: route => route.endsWith("/edits"), ms });
};

beforeEach(() => {
  localStorage.clear();
  stubWindow();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("a skills field that isn't a list", () => {
  const ALLOW =
    "layers:\n  project:\n    skills:\n      allow: [keep-me, keep-too]\n";

  it("shows what it holds, in a field of its own", async () => {
    await openFile(ALLOW);
    expect(
      screen
        .getAllByRole<HTMLInputElement>("textbox", { hidden: true })
        .map(box => box.value),
    ).toEqual(expect.arrayContaining(["keep-me", "keep-too"]));
  });

  it("is safe from the skills lists around it", async () => {
    const opened = await openFile(ALLOW);
    const path = nth(screen.getAllByLabelText("Skill by path"), 0);
    await opened.user.type(path, "./new");
    await opened.user.tab();
    await settle(30);
    expect(opened.text()).toContain("keep-me");
    expect(parseWorkflow(opened.text()).ok).toBe(true);
  });
});

describe("a row changed right after typing in another", () => {
  it("keeps a list's typed text when another row is added", async () => {
    const opened = await openFile();
    await selectNode(opened);
    const { user } = opened;
    await user.click(addButton(/Add to notify/iu));
    const body = await screen.findByLabelText(/^Body/iu);
    await user.type(body, "AAA");
    holdEdits(opened, 30);
    await user.click(addButton(/Add to notify/iu));
    await settle(120);
    // A slow runner can draw the new row after the held edit lands.
    await waitFor(() => {
      expect(screen.getAllByLabelText(/^Body/iu)).toHaveLength(2);
    });
    expect(opened.text()).toContain("body: AAA");
  });

  it("keeps a row's typed text when an earlier row is removed", async () => {
    const opened = await openFile();
    await selectNode(opened);
    const { user } = opened;
    await user.click(addButton(/Add to notify/iu));
    await screen.findByLabelText(/^Body/iu);
    await user.click(addButton(/Add to notify/iu));
    await waitFor(() => {
      expect(screen.getAllByLabelText(/^Body/iu)).toHaveLength(2);
    });
    const second = nth(screen.getAllByLabelText(/^Body/iu), 1);
    await user.type(second, "KEEP");
    holdEdits(opened, 30);
    await user.click(addButton(/Remove notify 1/iu));
    await settle(120);
    await waitFor(() => {
      expect(screen.getAllByLabelText(/^Body/iu)).toHaveLength(1);
    });
    expect(opened.text()).toContain("body: KEEP");
  });
});

describe("a named value", () => {
  it("can't be added twice over the one that's there", async () => {
    const opened = await openFile();
    await selectNode(opened);
    const { user } = opened;
    await user.type(newName(), "TOKEN");
    await user.click(addButton(/Add to environment/iu));
    await user.type(await screen.findByLabelText(/^Token/u), "precious");
    await user.tab();
    await waitFor(() => {
      expect(opened.text()).toContain("TOKEN: precious");
    });
    await user.type(newName(), "TOKEN");
    expect(
      addButton(/Add to environment/iu).getAttribute("aria-disabled"),
    ).toBe("true");
    await user.click(addButton(/Add to environment/iu));
    await settle(20);
    expect(opened.text()).toContain("TOKEN: precious");
  });
});

describe("an input's default", () => {
  it("stays text when the input says it's text", async () => {
    const opened = await openFile(
      inputOf("    type: string\n    default: '1.9'\n"),
    );
    const box = await screen.findByLabelText(/^Default/iu);
    await opened.user.clear(box);
    await opened.user.type(box, "1.10");
    await opened.user.tab();
    await waitFor(() => {
      expect(opened.text()).toMatch(/default: ["']?1\.10["']?/u);
    });
    expect(parseWorkflow(opened.text()).ok).toBe(true);
    expect(opened.text()).toMatch(/default: ["']1\.10["']/u);
  });

  it("keeps a line break in a value", async () => {
    const opened = await openFile(inputOf('    default: "line1\\nline2"\n'));
    const box = await screen.findByLabelText<HTMLTextAreaElement>(/^Default/iu);
    expect(box.value).toBe("line1\nline2");
    await opened.user.type(box, "!");
    await opened.user.tab();
    await waitFor(() => {
      expect(opened.text()).toContain("line2!");
    });
    expect(opened.text()).toMatch(/line1/u);
  });
});

describe("the name of a node", () => {
  it("renames once on Enter then Tab, with no false alarm", async () => {
    const opened = await openFile();
    await selectNode(opened);
    const { user, log } = opened;
    const name = screen.getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "m");
    holdEdits(opened, 20);
    await user.keyboard("{Enter}");
    await user.tab();
    await settle(80);
    expect(log.filter(line => line === "edits a")).toHaveLength(1);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(opened.text()).toContain("  m:");
  });
});

describe("typing on after Enter", () => {
  it("keeps the new text when the answer lands", async () => {
    const opened = await openFile();
    await selectNode(opened);
    const { user } = opened;
    const label = screen.getByLabelText<HTMLInputElement>(/^Label/iu);
    await user.type(label, "abc");
    holdEdits(opened, 30);
    await user.keyboard("{Enter}");
    await user.keyboard("def");
    await settle(80);
    expect(screen.getByLabelText<HTMLInputElement>(/^Label/iu).value).toBe(
      "abcdef",
    );
  });
});

describe("Discard", () => {
  it("asks first, and does nothing if the answer is no", async () => {
    const opened = await openFile();
    await selectNode(opened);
    const { user, log } = opened;
    const name = screen.getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "m");
    await user.tab();
    await waitFor(() => {
      expect(opened.text()).toContain("  m:");
    });
    await user.click(screen.getByRole("button", { name: "Discard" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("can't be undone");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(log).not.toContain("discard a");
    await user.click(screen.getByRole("button", { name: "Discard" }));
    await user.click(
      await screen.findByRole("button", { name: "Discard the draft" }),
    );
    await waitFor(() => {
      expect(log).toContain("discard a");
    });
  });
});
