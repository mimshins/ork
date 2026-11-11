/**
 * @file Tests for the For each group in the panel (RFC-013), against the real
 *   document edits: the list is chosen, never typed, and what's chosen is what
 *   the file says.
 */

import { parseWorkflow } from "@krapht/ork-server";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BuilderPanel } from "../../src/builder/builder-panel.tsx";
import { violations } from "../axe.ts";
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
  plan:
    type: agent.worker
    output:
      schema:
        verdict: [pass, fail]
        tasks:
          list: { title: string }
  scan:
    type: tool.shell
    command: x
    output:
      format: json
  build:
    type: agent.worker
    prompt: Do it.
  lonely:
    type: agent.worker
edges:
  - plan -> build
  - scan -> build
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
  await screen.findByRole("combobox", { name: "Run this node" });
  return { user, text: (): string => fake.files["a"]?.text ?? "" };
};

type Opened = Awaited<ReturnType<typeof open>>;

const choose = async ({ user }: Opened, label: string, option: string) => {
  await user.click(screen.getByRole("combobox", { name: label }));
  await user.click(await screen.findByRole("option", { name: option }));
};

const optionsOf = async ({ user }: Opened, label: string) => {
  await user.click(screen.getByRole("combobox", { name: label }));
  const list = await screen.findByRole("listbox");
  const names = within(list)
    .getAllByRole("option")
    .map(option => option.textContent);
  await user.keyboard("{Escape}");
  return names;
};

const group = (): HTMLDetailsElement | null =>
  screen.getByRole("combobox", { name: "Run this node" }).closest("details");

const FANNED = TEXT.replace(
  "    prompt: Do it.\n",
  '    prompt: Do it.\n    forEach:\n      from: "{{nodes.plan.output.tasks}}"\n      maxItems: 4\n',
);

beforeEach(() => {
  stubWindow();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the For each group", () => {
  it("writes the whole template when a list is chosen", async () => {
    const opened = await open("build");
    await choose(
      opened,
      "Run this node",
      "Once per item of a list from an earlier node",
    );
    await waitFor(() => {
      expect(opened.text()).toContain("maxItems: 10");
    });
    await choose(opened, "List from", "tasks (from plan)");
    await waitFor(() => {
      expect(opened.text()).toContain('from: "{{nodes.plan.output.tasks}}"');
    });
    await waitFor(() => {
      expect(document.body.textContent).toContain("Each item has title.");
    });
    expect(parseWorkflow(opened.text()).ok).toBe(true);
  });

  it("offers only lists, of nodes that run before this one", async () => {
    const opened = await open("build", FANNED);
    expect(await optionsOf(opened, "List from")).toEqual(["tasks (from plan)"]);
  });

  it("offers none from a node nothing leads out of", async () => {
    const opened = await open("lonely");
    await choose(
      opened,
      "Run this node",
      "Once per item of a list from an earlier node",
    );
    expect(
      await screen.findByText(/No earlier node declares a list/u),
    ).toBeTruthy();
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: /^Add a list/u })
        .disabled,
    ).toBe(true);
  });

  it("keeps a path it doesn't offer, so it is seen", async () => {
    await open(
      "build",
      TEXT.replace(
        "    prompt: Do it.\n",
        '    prompt: Do it.\n    forEach:\n      from: "{{nodes.scan.output.stdout}}"\n      maxItems: 4\n',
      ),
    );
    expect(
      await screen.findByRole("combobox", { name: "List from" }),
    ).toHaveProperty("textContent", expect.stringContaining("(not offered)"));
  });

  it("declares a list and reads it in one change", async () => {
    const opened = await open("build");
    await choose(
      opened,
      "Run this node",
      "Once per item of a list from an earlier node",
    );
    await opened.user.click(
      await screen.findByRole("button", { name: /^Add a list/u }),
    );
    await choose(opened, "On node", "scan");
    await opened.user.type(screen.getByLabelText("New list"), "paths");
    await opened.user.type(
      screen.getByLabelText("Item fields"),
      "path, size:number",
    );
    await opened.user.click(screen.getByRole("button", { name: "Add paths" }));
    await waitFor(() => {
      expect(opened.text()).toContain(
        'from: "{{nodes.scan.output.json.paths}}"',
      );
    });
    expect(opened.text()).toMatch(
      /paths:\n\s+list:\n\s+path: string\n\s+size: number/u,
    );
  });

  it("refuses a name the node already has", async () => {
    const opened = await open("build");
    await choose(
      opened,
      "Run this node",
      "Once per item of a list from an earlier node",
    );
    await opened.user.click(
      await screen.findByRole("button", { name: /^Add a list/u }),
    );
    await choose(opened, "On node", "plan");
    await opened.user.type(screen.getByLabelText("New list"), "tasks");
    expect(await screen.findByText(/is already a field of/u)).toBeTruthy();
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Add tasks" })
        .disabled,
    ).toBe(true);
  });

  it("says a count that isn't a whole number above 0, and sends nothing", async () => {
    const opened = await open("build", FANNED);
    const before = opened.text();
    const box = screen.getByLabelText(/^Most items/u);
    await opened.user.clear(box);
    await opened.user.type(box, "0");
    await opened.user.tab();
    expect(
      await screen.findByText("Most items needs a whole number above 0."),
    ).toBeTruthy();
    expect(opened.text()).toBe(before);
  });

  it("keeps the other keys when the kind changes, and removes the group for Once", async () => {
    const opened = await open("build", FANNED);
    await choose(opened, "When an item fails", "Start no more items");
    await waitFor(() => {
      expect(opened.text()).toContain("onFailure: stop");
    });
    await choose(opened, "Run this node", "Once per item, listed here");
    await waitFor(() => {
      expect(opened.text()).toContain("onFailure: stop");
    });
    expect(opened.text()).not.toContain("maxItems");
    await choose(opened, "Run this node", "Once");
    await waitFor(() => {
      expect(opened.text()).not.toContain("forEach");
    });
  });
});

describe("accessibility", () => {
  it("has nothing for axe to find in the group or the Add a list form", async () => {
    const opened = await open("build", FANNED);
    await expect(violations(document.body)).resolves.toEqual([]);
    await opened.user.click(
      await screen.findByRole("button", { name: /^Add a list/u }),
    );
    await screen.findByLabelText("New list");
    await expect(violations(document.body)).resolves.toEqual([]);
  });

  it("announces a count that isn't a whole number", async () => {
    const opened = await open("build", FANNED);
    const box = screen.getByLabelText(/^Most items/u);
    await opened.user.clear(box);
    await opened.user.type(box, "0");
    await opened.user.tab();
    const line = await screen.findByText(
      "Most items needs a whole number above 0.",
    );
    expect(line.closest("[role=alert]")).not.toBeNull();
  });

  it("moves focus into the Add a list form, and back on Cancel", async () => {
    const opened = await open("build", FANNED);
    await opened.user.click(
      await screen.findByRole("button", { name: /^Add a list/u }),
    );
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole("combobox", { name: "On node" }),
      );
    });
    await opened.user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: /^Add a list/u }),
      );
    });
  });

  it("leaves focus on List from after a list is declared", async () => {
    const opened = await open("build");
    await choose(
      opened,
      "Run this node",
      "Once per item of a list from an earlier node",
    );
    await opened.user.click(
      await screen.findByRole("button", { name: /^Add a list/u }),
    );
    await choose(opened, "On node", "scan");
    await opened.user.type(screen.getByLabelText("New list"), "paths");
    await opened.user.click(screen.getByRole("button", { name: "Add paths" }));
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole("combobox", { name: "List from" }),
      );
    });
  });
});

describe("{{item}}", () => {
  it("is offered on a fanned node's prompt, with the item's fields", async () => {
    await open("build", FANNED);
    expect(
      await screen.findByText(/Reads/u, { selector: "p *, p" }),
    ).toBeTruthy();
    expect(screen.getAllByText("{{item.title}}").length).toBeGreaterThan(0);
  });

  it("is never mentioned on a node that isn't fanned", async () => {
    await open("build");
    expect(screen.queryByText("{{item}}")).toBeNull();
    expect(screen.queryByText(/Reads/u)).toBeNull();
  });

  it("stays open when the user chooses Once from inside it", async () => {
    const opened = await open("build", FANNED);
    expect(group()?.open).toBe(true);
    await choose(opened, "Run this node", "Once");
    await waitFor(() => {
      expect(opened.text()).not.toContain("forEach");
    });
    expect(group()?.open).toBe(true);
  });

  it("offers a list on an earlier node that is not behind a loop", async () => {
    const opened = await open(
      "build",
      TEXT.replace(
        "edges:\n",
        "edges:\n  - plan -> split\n  - split -> build\n",
      ).replace("  lonely:", "  split:\n    type: control.split\n  lonely:"),
    );
    await choose(
      opened,
      "Run this node",
      "Once per item of a list from an earlier node",
    );
    await opened.user.click(
      await screen.findByRole("button", { name: /^Add a list/u }),
    );
    await choose(opened, "On node", "plan");
    expect(screen.getByLabelText("New list")).toBeTruthy();
  });
});
