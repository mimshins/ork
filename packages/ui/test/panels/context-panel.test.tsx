/**
 * @file Tests for the Context panel on a fake server: it shows the chosen
 *   node's stack, follows a run's node and the Builder's draft, opens a piece's
 *   words, says why a piece is off and why a node has no context, names the
 *   files that changed since the run started, and keeps the last answer when an
 *   update fails. Its access is tested in `context-access.test.tsx`.
 */

import type { NodeContextAnswer } from "@krapht/ork-server/client";
import { act, cleanup, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { stubWindow } from "../dom.ts";
import { planned } from "./context-fixtures.ts";
import {
  chooseBuilderNode,
  chooseRunNode,
  open,
  reviewView,
  row,
  rowNamed,
} from "./context-harness.tsx";

beforeEach(() => {
  stubWindow();
});

afterEach(() => {
  cleanup();
});

/** The header's Appended size, as a screen reader reads it ("about"). */
const appended = (tokens: string): Promise<HTMLElement> =>
  screen.findByText(
    (_, element) =>
      element?.tagName === "DD" &&
      element.textContent === `≈about ${tokens} tokens`,
  );

/** The words an opened row controls. */
const wordsOf = (button: HTMLElement): HTMLElement => {
  const id = button.getAttribute("aria-controls");
  const words =
    id === null ? null : document.querySelector<HTMLElement>(`[id="${id}"]`);
  if (words === null) throw new Error("The row controls nothing.");
  return words;
};

/** Answers every ask, or refuses it while `server.refuse` is set. */
const refusingWhen =
  (server: { refuse: boolean }, refusal: string) =>
  (): NodeContextAnswer | string =>
    server.refuse ? refusal : planned();

describe("the Context panel", () => {
  it("says how to choose a node when none is chosen", async () => {
    const opened = open();
    expect(screen.getByText("No node chosen.")).toBeDefined();
    await chooseRunNode(opened, null);
    expect(screen.getByText("No node chosen in this run.")).toBeDefined();
    await chooseBuilderNode(opened, null);
    expect(screen.getByText("No node selected in the Builder.")).toBeDefined();
  });

  it("shows a run's node's stack, in the CLI's order, with its command", async () => {
    const opened = open();
    await chooseRunNode(opened, "fix");
    await rowNamed(
      "ork:review, live, workflow layer, .ork/workflows/skills/review, about 1,204 tokens",
    );
    expect(
      screen.getAllByRole("heading", { level: 3 }).map(h => h.textContent),
    ).toEqual([
      "Agent",
      "Project instructions",
      "Skills",
      "Context files",
      "Practices",
      "Appended system prompt",
    ]);
    expect(
      screen.getByRole("heading", { level: 2, name: "fix" }),
    ).toBeDefined();
    expect(screen.getByText("w · aaa11111")).toBeDefined();
    expect(
      screen.getByText(
        "ork context explain .ork/workflows/review.ork.yaml fix",
      ),
    ).toBeDefined();
    expect(opened.asked).toEqual([{ kind: "run", node: "fix" }]);
  });

  it("says why a piece is off, and opens its words on demand", async () => {
    await chooseRunNode(open(), "fix");
    const off = await rowNamed(
      "review, off, project layer, .claude/skills/review, about 9 tokens",
    );
    expect(off.getAttribute("aria-expanded")).toBe("false");
    expect(off.getAttribute("aria-describedby")).not.toBeNull();
    expect(screen.getByText("Shadowed by the workflow layer.")).toBeDefined();
    expect(screen.getByText("The project's own skill wins.")).toBeDefined();
    await userEvent.click(off);
    expect(off.getAttribute("aria-expanded")).toBe("true");
    const words = wordsOf(off);
    expect(words.textContent).toContain("project");
    expect(
      within(words).getByRole("button", { name: "Copy the text of review" }),
    ).toBeDefined();
  });

  it("names the files that changed after the run started", async () => {
    const opened = open(() =>
      planned({}, [".ork/workflows/review.ork.yaml", "AGENTS.md"]),
    );
    await chooseRunNode(opened, "fix");
    expect(
      (await screen.findByText(/^Changed after this run started:/u))
        .textContent,
    ).toBe(
      "Changed after this run started: .ork/workflows/review.ork.yaml, AGENTS.md. The run may have read older versions.",
    );
  });

  it("says a spawned worker is planned as the node it came from", async () => {
    const opened = open(() => planned({ node: "fix-2", template: "fix" }));
    await chooseRunNode(opened, "fix-2");
    expect(
      await screen.findByText(
        /was spawned during the run, so it's planned as/u,
      ),
    ).toBeDefined();
  });

  it("says why a node has no context, in the planner's words", async () => {
    const opened = open(() => ({
      planned: false,
      why: "`run` is a `tool.shell`, not a Claude node",
      changedSinceStart: [],
    }));
    await chooseRunNode(opened, "run");
    expect(await screen.findByText("No context to show.")).toBeDefined();
    expect(screen.getByText(/is a/u).textContent).toBe(
      "run is a tool.shell, not a Claude node.",
    );
  });

  it("follows the Builder's draft, asking again after each change", async () => {
    let tokens = 3120;
    const opened = open(() => planned({ appendedTokens: tokens }));
    await chooseBuilderNode(opened, "fix");
    expect(await appended("3,120")).toBeDefined();
    expect(screen.getByText("Builder · review · draft")).toBeDefined();
    expect(
      screen.getByText("The CLI reads the saved file, not the draft."),
    ).toBeDefined();
    tokens = 99;
    await act(async () => {
      opened.state.builder.update(reviewView(true));
      await Promise.resolve();
    });
    expect(await appended("99")).toBeDefined();
    expect(opened.asked).toEqual([
      { kind: "builder", node: "fix" },
      { kind: "builder", node: "fix" },
    ]);
  });

  it("keeps the last answer beside an update that failed, and tries again", async () => {
    const server = { refuse: false };
    const opened = open(refusingWhen(server, "No run `aaa11111`."));
    await chooseRunNode(opened, "fix");
    await row(/^ork:review/u);
    server.refuse = true;
    await userEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect((await screen.findByText(/^Couldn't update:/u)).textContent).toBe(
      "Couldn't update: No run aaa11111. This is the answer from before.",
    );
    expect(screen.getByRole("button", { name: /^ork:review/u })).toBeDefined();
    server.refuse = false;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.queryByText(/^Couldn't update/u)).toBeNull();
  });
});
