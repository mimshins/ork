/**
 * @file Tests for the Decisions panel on a fake server: it shows the question
 *   and its options with the recommended one, answers with a click, a digit key
 *   or Enter on the card, sends the note typed with it (and keys typed in the
 *   note stay there), keeps a refusal, moves the focus on when a card goes, and
 *   says who answered one that settled and what they said.
 */

import type { DecisionRecord } from "@krapht/ork-server/client";
import { act, cleanup, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DecisionsPanel } from "../../src/panels/decisions-panel.tsx";
import { violations } from "../axe.ts";
import { stubWindow } from "../dom.ts";
import { runView } from "../state/fixtures.ts";
import { type FakeRoutes, openPanelState, renderPanel } from "./harness.tsx";

const decision = (
  id: string,
  over: Partial<DecisionRecord> = {},
): DecisionRecord => ({
  id,
  runId: "aaa11111",
  node: "gate",
  kind: "question",
  question: `Merge ${id}?`,
  context: "The review passed.",
  options: [
    { id: "merge", label: "Merge it", description: "Goes to main." },
    { id: "reject" },
  ],
  recommended: "merge",
  openedAt: "2026-11-03T00:00:00.000Z",
  status: "open",
  ...over,
});

/** The text of each `code` element in a decision's card. */
const codesIn = (id: string): (string | null)[] =>
  [
    ...document.querySelectorAll<HTMLElement>(`[data-decision="${id}"] code`),
  ].map(code => code.textContent);

const open = async (
  list: DecisionRecord[] = [decision("d1")],
  routes: FakeRoutes = {},
) => {
  const opened = openPanelState(routes);
  renderPanel(opened.state, <DecisionsPanel />);
  await act(async () => {
    opened.overview.send("runs", [runView("aaa11111")]);
    opened.overview.send("decisions", list);
    await Promise.resolve();
  });
  return opened;
};

const card = (id: string): HTMLElement =>
  screen.getByRole("region", { name: new RegExp(`gate Merge ${id}\\?$`, "u") });

beforeEach(() => {
  localStorage.clear();
  stubWindow();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the Decisions panel", () => {
  const WRITTEN = "Run `rm -rf build` and ``deploy``?";

  it("shows a question as Markdown: its marks become code, not stray backticks", async () => {
    await open([decision("d1", { question: WRITTEN, context: "See `a`." })]);
    expect(document.querySelector("[data-decision=d1] p")?.textContent).toBe(
      "Run rm -rf build and deploy?",
    );
    expect(codesIn("d1")).toEqual(["rm -rf build", "deploy", "a"]);
  });

  it("shows a settled question as written too", async () => {
    const { overview } = await open([decision("d1", { question: WRITTEN })], {
      decisions: {
        d1: decision("d1", { question: WRITTEN, status: "withdrawn" }),
      },
    });
    await act(async () => {
      overview.send("decisions", []);
      await Promise.resolve();
    });
    const settled = await screen.findByRole("region", {
      name: "Settled decisions",
    });
    await vi.waitFor(() => {
      expect(settled.textContent).toContain(WRITTEN);
    });
    expect(screen.getByText(WRITTEN).querySelector("code")).toBeNull();
  });

  it("says when nothing waits", async () => {
    await open([]);
    expect(screen.getByText("No decisions waiting.")).toBeDefined();
  });

  it("shows the question, its context and options, and what it recommends", async () => {
    await open();
    const here = within(card("d1"));
    expect(here.getByText("The review passed.")).toBeDefined();
    expect(here.getByText("Goes to main.")).toBeDefined();
    expect(
      here.getByRole("button", { name: /Merge it.*recommended/u }),
    ).toBeDefined();
    expect(here.getByText("reject")).toBeDefined();
    expect(here.getByText(/aaa11111 · gate/u)).toBeDefined();
  });

  it("answers with one click", async () => {
    const user = userEvent.setup();
    const { controlled } = await open();
    await user.click(within(card("d1")).getByText("reject"));
    expect(controlled).toEqual([
      { kind: "answer", run: "d1", body: { choose: "reject" } },
    ]);
  });

  it("answers with a digit, with the focus in the card", async () => {
    const user = userEvent.setup();
    const { controlled } = await open();
    card("d1").focus();
    await user.keyboard("2");
    expect(controlled).toEqual([
      { kind: "answer", run: "d1", body: { choose: "reject" } },
    ]);
  });

  it("takes the recommended option with Enter on the card", async () => {
    const user = userEvent.setup();
    const { controlled } = await open();
    card("d1").focus();
    await user.keyboard("{Enter}");
    expect(controlled).toEqual([
      { kind: "answer", run: "d1", body: { choose: "merge" } },
    ]);
  });

  it("ignores keys that are not its own", async () => {
    const user = userEvent.setup();
    const { controlled } = await open();
    card("d1").focus();
    await user.keyboard("{Control>}1{/Control}9");
    expect(controlled).toEqual([]);
  });

  it("sends the note typed in its box with the answer", async () => {
    const user = userEvent.setup();
    const { controlled } = await open();
    const here = within(card("d1"));
    await user.type(
      here.getByRole("textbox", { name: "Note for the run (optional)" }),
      "Cut the API section",
    );
    expect(
      here.getByText(
        "ork decide aaa11111 --id d1 --choose <option> --say 'Cut the API section'",
      ),
    ).toBeDefined();
    await user.click(here.getByText("reject"));
    expect(controlled).toEqual([
      {
        kind: "answer",
        run: "d1",
        body: { choose: "reject", note: "Cut the API section" },
      },
    ]);
  });

  it("keeps digits and Enter typed in the note in the note", async () => {
    const user = userEvent.setup();
    const { controlled } = await open();
    const box = within(card("d1")).getByRole("textbox", {
      name: "Note for the run (optional)",
    });
    await user.type(box, "Step 2{Enter}then 3");
    expect(controlled).toEqual([]);
    expect(box).toHaveProperty("value", "Step 2\nthen 3");
  });

  it("sends no note when the box is blank", async () => {
    const user = userEvent.setup();
    const { controlled } = await open();
    const here = within(card("d1"));
    await user.type(
      here.getByRole("textbox", { name: "Note for the run (optional)" }),
      "   ",
    );
    await user.click(here.getByText("reject"));
    expect(controlled).toEqual([
      { kind: "answer", run: "d1", body: { choose: "reject" } },
    ]);
  });

  it("keeps a refusal in the server's words", async () => {
    const user = userEvent.setup();
    await open([decision("d1")], { refuseAnswer: "Already answered." });
    await user.click(within(card("d1")).getByText("reject"));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Already answered.",
    );
  });

  it("tells apart two cards asking the same thing", async () => {
    await open([
      decision("d1", { question: "Merge?" }),
      decision("d2", { question: "Merge?", runId: "bbb22222" }),
    ]);
    expect(
      screen.getByRole("region", { name: /aaa11111 · gate Merge\?$/u }),
    ).toBeDefined();
    expect(
      screen.getByRole("region", { name: /bbb22222 · gate Merge\?$/u }),
    ).toBeDefined();
  });

  it("moves the focus to the next card when the focused one goes", async () => {
    const { overview } = await open([decision("d1"), decision("d2")]);
    card("d1").focus();
    const next = decision("d2");
    await act(async () => {
      overview.send("decisions", [next]);
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(card("d2"));
    });
  });

  it("moves the focus to the panel, named, when the last card goes", async () => {
    const { overview } = await open();
    card("d1").focus();
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

  it("says who answered one that settled elsewhere", async () => {
    const { overview } = await open([decision("d1")], {
      decisions: {
        d1: decision("d1", {
          status: "answered",
          answer: "merge",
          answeredBy: "decide",
        }),
      },
    });
    await act(async () => {
      overview.send("decisions", []);
      await Promise.resolve();
    });
    const settled = await screen.findByRole("region", {
      name: "Settled decisions",
    });
    await vi.waitFor(() => {
      expect(settled.textContent).toContain(
        "Answered Merge it with ork decide.",
      );
    });
  });

  it("shows what was said with a settled answer, and nothing for an old one", async () => {
    const { overview } = await open([decision("d1"), decision("d2")], {
      decisions: {
        d1: decision("d1", {
          status: "answered",
          answer: "reject",
          answeredBy: "ui",
          note: "Rebase first",
        }),
        d2: decision("d2", {
          status: "answered",
          answer: "merge",
          answeredBy: "terminal",
        }),
      },
    });
    await act(async () => {
      overview.send("decisions", []);
      await Promise.resolve();
    });
    const settled = await screen.findByRole("region", {
      name: "Settled decisions",
    });
    await vi.waitFor(() => {
      expect(settled.querySelectorAll("li")).toHaveLength(2);
    });
    expect(settled.textContent).toContain("They said: Rebase first");
    expect(settled.textContent?.match(/They said/gu)).toHaveLength(1);
  });

  it("has nothing for axe to find", async () => {
    await open();
    await expect(violations(document.body)).resolves.toEqual([]);
  });

  it("has nothing for axe to find with a note typed", async () => {
    const user = userEvent.setup();
    await open();
    await user.type(
      within(card("d1")).getByRole("textbox", {
        name: "Note for the run (optional)",
      }),
      "Cut it",
    );
    await expect(violations(document.body)).resolves.toEqual([]);
  });
});
