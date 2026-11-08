/**
 * @file Tests for reading a decision: long text folds behind "Show all" and
 *   unfolds when focus enters it, a document opens in a dialog that names
 *   itself and gives focus back, a permission's command is one block with a
 *   copy button, no fold or Read control takes a digit, and the card, folded
 *   and with the dialog open, has nothing for axe to find.
 */

import type { DecisionRecord } from "@krapht/ork-server/client";
import { act, cleanup, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DecisionsPanel } from "../../src/panels/decisions-panel.tsx";
import { violations } from "../axe.ts";
import { stubWindow } from "../dom.ts";
import { runView } from "../state/fixtures.ts";
import { openPanelState, renderPanel } from "./harness.tsx";

const lines = (count: number): string =>
  Array.from({ length: count }, (_, at) => `line ${at + 1}`).join("\n");

/** The text a Show all button folds, by its `aria-controls`. */
const foldOf = (button: HTMLElement): HTMLElement =>
  document.querySelector<HTMLElement>(
    `[id="${button.getAttribute("aria-controls") ?? ""}"]`,
  ) ?? button;

/** The `code` element whose text is exactly this. */
const codeOf = (text: string): HTMLElement | undefined =>
  [...document.querySelectorAll<HTMLElement>("code")].find(
    el => el.textContent === text,
  );

const decision = (over: Partial<DecisionRecord> = {}): DecisionRecord => ({
  id: "7b3e",
  runId: "4f2a1c",
  node: "approve",
  kind: "question",
  question: "Approve the spec?",
  options: [{ id: "yes" }, { id: "no" }],
  recommended: "yes",
  openedAt: "2026-11-03T00:00:00.000Z",
  status: "open",
  ...over,
});

const open = async (...list: DecisionRecord[]) => {
  const opened = openPanelState();
  renderPanel(opened.state, <DecisionsPanel />);
  await act(async () => {
    opened.overview.send("runs", [runView("4f2a1c")]);
    opened.overview.send("decisions", list);
    await Promise.resolve();
  });
  return opened;
};

beforeEach(() => {
  localStorage.clear();
  stubWindow();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("a long question", () => {
  it("folds past 20 lines behind Show all, and has no button at 20", async () => {
    const user = userEvent.setup();
    await open(decision({ question: lines(21) }));
    const more = screen.getByRole("button", { name: "Show all (21 lines)" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    expect(foldOf(more).textContent).toContain("line 21");
    await user.click(more);
    const less = screen.getByRole("button", { name: "Show less" });
    expect(less.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(less);
    cleanup();
    await open(decision({ question: lines(20) }));
    expect(screen.queryByRole("button", { name: /Show all/u })).toBeNull();
  });

  it("unfolds when focus enters a link inside it", async () => {
    const user = userEvent.setup();
    await open(
      decision({ question: `${lines(30)}\n\n[docs](https://example.com)` }),
    );
    await user.tab();
    await user.click(screen.getByRole("link", { name: /docs/u }));
    expect(screen.getByRole("button", { name: "Show less" })).toBeDefined();
  });

  it("keeps the note box and the options in the card, outside the fold", async () => {
    await open(decision({ question: lines(40) }));
    const card = screen.getByRole("region", {
      name: /approve Approve|line 1/u,
    });
    expect(
      within(card).getByRole("textbox", { name: /Note for the run/u }),
    ).toBeDefined();
    expect(
      foldOf(screen.getByRole("button", { name: /Show all/u })).contains(
        within(card).getByRole("button", { name: /yes/u }),
      ),
    ).toBe(false);
  });

  it("takes no digit or Enter from the fold, Read or copy controls", async () => {
    const user = userEvent.setup();
    const { controlled } = await open(
      decision({ question: lines(30), document: "# Spec\n\nbody" }),
    );
    const more = screen.getByRole("button", { name: /Show all/u });
    more.focus();
    await user.keyboard("1");
    await user.keyboard("{Enter}");
    screen.getByRole("button", { name: "Read document" }).focus();
    await user.keyboard("2");
    expect(controlled).toEqual([]);
  });
});

describe("a document", () => {
  const DOC = `# Spec\n\n${lines(80)}\n\n\`\`\`\ncode\n\`\`\``;

  it("shows its length and opens in a dialog named for the node and decision", async () => {
    const user = userEvent.setup();
    await open(decision({ document: DOC }));
    expect(screen.getByText(/\d+ lines/u)).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Read document" }));
    const dialog = await screen.findByRole("dialog", {
      name: "approve · 7b3e",
    });
    expect(dialog.textContent).toContain("Document for run 4f2a1c. Read-only.");
    const region = within(dialog).getByRole("region", { name: "Document" });
    expect(region.getAttribute("tabindex")).toBe("0");
    expect(
      within(region).getByRole("heading", { name: "Spec", level: 3 }),
    ).toBeDefined();
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(region);
    });
  });

  it("closes on Escape and on Close, and gives focus back to Read document", async () => {
    const user = userEvent.setup();
    await open(decision({ document: DOC }));
    const read = screen.getByRole("button", { name: "Read document" });
    await user.click(read);
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    await vi.waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(document.activeElement).toBe(read);
    await user.click(read);
    await user.click(await screen.findByRole("button", { name: "Close" }));
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(read);
    });
  });

  it("takes no digit typed in the open dialog as an answer", async () => {
    const user = userEvent.setup();
    const { controlled } = await open(
      decision({ document: "[docs](https://example.com)\n\n" + DOC }),
    );
    await user.click(screen.getByRole("button", { name: "Read document" }));
    const dialog = await screen.findByRole("dialog");
    const region = within(dialog).getByRole("region", { name: "Document" });
    region.focus();
    await user.keyboard("1");
    within(dialog).getByRole("link", { name: /docs/u }).focus();
    await user.keyboard("2{Enter}");
    expect(controlled).toEqual([]);
  });

  it("names the dialog's copy buttons apart from the card's", async () => {
    const user = userEvent.setup();
    await open(decision({ question: "```\nq\n```", document: "```\nd\n```" }));
    await user.click(screen.getByRole("button", { name: "Read document" }));
    await screen.findByRole("dialog");
    expect(
      screen.getByRole("button", { name: "Copy code (approve document)" }),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Copy code (approve)", hidden: true }),
    ).toBeDefined();
  });

  it("puts the focus on the panel when the card goes with its dialog open", async () => {
    const user = userEvent.setup();
    const { overview } = await open(decision({ document: DOC }));
    await user.click(screen.getByRole("button", { name: "Read document" }));
    await screen.findByRole("dialog");
    await act(async () => {
      overview.send("decisions", []);
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole("group", { name: "Decisions" }),
      );
    });
  });

  it("answers without opening it", async () => {
    const user = userEvent.setup();
    const { controlled } = await open(
      decision({ question: "", document: DOC }),
    );
    await user.click(screen.getByRole("button", { name: /yes/u }));
    expect(controlled).toEqual([
      { kind: "answer", run: "7b3e", body: { choose: "yes" } },
    ]);
  });

  it("has nothing for axe to find with a folded question and the dialog open", async () => {
    const user = userEvent.setup();
    await open(decision({ question: lines(40), document: DOC }));
    await expect(violations(document.body)).resolves.toEqual([]);
    await user.click(screen.getByRole("button", { name: "Read document" }));
    await screen.findByRole("dialog");
    await expect(violations(document.body)).resolves.toEqual([]);
  });
});

describe("a permission request", () => {
  it("shows its command as one block with a copy button, newlines kept", async () => {
    const command = "git commit -m 'a\n\nb'";
    await open(
      decision({
        kind: "permission",
        question: "Allow Bash?",
        context: command,
        options: [{ id: "allow" }, { id: "deny" }],
      }),
    );
    expect(
      screen.getByRole("button", { name: "Copy command (approve)" }),
    ).toBeDefined();
    expect(codeOf(command)).toBeDefined();
  });

  it("captions other input as json", async () => {
    await open(
      decision({
        kind: "permission",
        question: "Allow Edit?",
        context: '{\n  "a": 1\n}',
        options: [{ id: "allow" }, { id: "deny" }],
      }),
    );
    expect(screen.getByText("json")).toBeDefined();
  });
});
