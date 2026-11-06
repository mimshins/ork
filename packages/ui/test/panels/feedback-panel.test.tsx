/**
 * @file Tests for the Feedback panel on a fake server: it lists every item with
 *   its whole name, filters by status and by what it's about with counts that
 *   don't move, shows a chosen item's facts and records newest first, shows the
 *   buttons its target allows and disables them with the server's reason,
 *   dismisses and restores with the focus kept, accepts, splits, follows the
 *   runs at most every 5 s, and passes axe.
 */

import { act, cleanup, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { violations } from "../axe.ts";
import { stubWindow } from "../dom.ts";
import { runView } from "../state/fixtures.ts";
import {
  AGENTS,
  item,
  ITEMS,
  LOOP,
  MERGED,
  ORK,
  record,
  refused,
  whole,
} from "./feedback-fixtures.ts";
import {
  actions,
  announced,
  asked,
  choose,
  openFeedback,
  pick,
  rowOf,
  settle,
} from "./feedback-harness.tsx";

const LOOP_TITLE = "The loop reviews -> lead ran out of its 2 rounds";

/** What a screen reader calls a button: its label, or its words. */
const nameOf = (element: HTMLElement): string =>
  element.getAttribute("aria-label") ?? element.textContent;

beforeEach(() => {
  localStorage.clear();
  stubWindow();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the Feedback panel's list", () => {
  it("lists every item, named by what it shows, with none chosen", async () => {
    await openFeedback();
    const rows = within(screen.getByRole("list", { name: "Feedback items" }))
      .getAllByRole("button")
      .map(row => nameOf(row));
    expect(rows).toHaveLength(3);
    // Named by its content: what it shows, in order (feedback-names.test.tsx).
    expect(rows[0]).toMatch(
      /^The loop reviews -> lead ran out of its 2 rounds, new, 9fae0c1d2e3f, /u,
    );
    expect(screen.getByText("3 items")).toBeDefined();
    expect(
      screen.getByText("Choose an item to read its records."),
    ).toBeDefined();
    expect(rowOf(LOOP_TITLE).getAttribute("aria-current")).toBeNull();
  });

  it("is one tab stop, and the arrow keys move through it", async () => {
    await openFeedback();
    const first = rowOf(LOOP_TITLE);
    expect(first.tabIndex).toBe(0);
    expect(rowOf("AGENTS.md has no test command").tabIndex).toBe(-1);
    first.focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(rowOf("AGENTS.md has no test command"));
    await userEvent.keyboard("{End}");
    expect(document.activeElement?.textContent).toMatch(
      /^`feedback` tool error/u,
    );
  });

  it("counts each status from everything read, and filters by it", async () => {
    const opened = await openFeedback({
      items: [...ITEMS, item(MERGED, { status: "dismissed", title: "Gone" })],
    });
    await userEvent.click(screen.getByRole("combobox", { name: "Status" }));
    const options = (await screen.findAllByRole("option")).map(
      option => option.textContent,
    );
    expect(options).toEqual([
      "Not dismissed · 3",
      "All · 4",
      "New · 3",
      "Triaged · 0",
      "Accepted · 0",
      "Resolved · 0",
      "Published · 0",
      "Dismissed · 1",
    ]);
    await userEvent.click(
      screen.getByRole("option", { name: "Dismissed · 1" }),
    );
    expect(screen.getByText("1 item")).toBeDefined();
    expect(rowOf("Gone")).toBeDefined();
    expect(announced(opened)).toBe("1 item.");
  });

  it("filters by what an item is about, and says when that leaves none", async () => {
    await openFeedback();
    await pick("About", "ork");
    expect(screen.getByText("1 item")).toBeDefined();
    await pick("Status", "Published · 0");
    expect(screen.getByText("Nothing published about ork.")).toBeDefined();
    expect(
      screen.getByText("Status: All and About: All show every item."),
    ).toBeDefined();
  });

  it("says when there's no feedback at all, with its CLI twin", async () => {
    await openFeedback({ items: [] });
    expect(screen.getByText("No feedback yet.")).toBeDefined();
    expect(screen.getByText("ork feedback list")).toBeDefined();
  });

  it("follows the runs, at most every 5 s", async () => {
    const opened = await openFeedback();
    const reads = () => asked(opened, "list").length;
    const before = reads();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    await act(async () => {
      opened.overview.send("runs", [runView("aaa11111")]);
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(reads()).toBe(before);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(reads()).toBe(before + 1);
  });
});

describe("an item's detail", () => {
  it("shows its facts, its records newest first and its CLI twin", async () => {
    await openFeedback({
      details: {
        [LOOP]: {
          records: [
            record(LOOP, { title: LOOP_TITLE, body: "First." }, { id: 1 }),
            record(
              LOOP,
              { title: "Merged in", body: "Second.", evidence: ["a", "b"] },
              { id: 2, runId: "77aa0000", node: "lead" },
            ),
          ],
        },
      },
    });
    await choose(LOOP_TITLE);
    expect(
      screen.getByRole("heading", { level: 2, name: LOOP_TITLE }),
    ).toBeDefined();
    expect(document.activeElement).toBe(rowOf(LOOP_TITLE));
    expect(rowOf(LOOP_TITLE).getAttribute("aria-current")).toBe("true");
    const records = within(
      screen.getByRole("list", {
        name: "Records of 9fae0c1d2e3f, newest first",
      }),
    ).getAllByRole("listitem");
    expect(records.map(r => r.textContent)).toEqual([
      expect.stringContaining("Second."),
      expect.stringContaining("First."),
    ]);
    expect(
      screen.getByRole("heading", { level: 4, name: "Merged in" }),
    ).toBeDefined();
    expect(screen.getByText("a, b")).toBeDefined();
    expect(screen.getByText("Records · 2, newest first")).toBeDefined();
    expect(screen.getByText("ork feedback show 9fae0c1d2e3f")).toBeDefined();
    expect(screen.getByText("review-loop")).toBeDefined();
  });

  it("opens a record's run and node in the Monitor", async () => {
    const opened = await openFeedback();
    await choose(LOOP_TITLE);
    await userEvent.click(
      screen.getByRole("button", {
        name: /^Open run\s*4f2a1c00 at reviews, /u,
      }),
    );
    expect(opened.goTo).toHaveBeenCalledWith("monitor");
    expect(opened.state.selection.getValue()).toEqual({
      run: "4f2a1c00",
      node: "reviews",
    });
    expect(opened.state.takeArrival("4f2a1c00")).toBe(true);
  });

  it("shows a workflow's actions, disabled with the server's reasons", async () => {
    const opened = await openFeedback({
      details: {
        [LOOP]: {
          actions: {
            accept: refused("accepted already"),
            lesson: { ok: true },
            apply: refused("dismissed; restore it first"),
            publish: refused("only feedback about Ork is shared"),
          },
        },
      },
    });
    await choose(LOOP_TITLE);
    const names = actions()
      .getAllByRole("button")
      .map(button => nameOf(button));
    expect(names).toEqual([
      "Accept: accepted already",
      "Add lesson…",
      "Propose fix…: dismissed; restore it first",
      "Dismiss",
    ]);
    const fix = actions().getByRole("button", { name: /^Propose fix/u });
    expect(fix.getAttribute("aria-disabled")).toBe("true");
    await userEvent.click(fix);
    expect(asked(opened, "apply")).toEqual([]);
  });

  it("shows an `ork` item's actions, and what it has instead of a lesson", async () => {
    await openFeedback();
    await choose("`feedback` tool error: invalid evidence");
    expect(
      actions()
        .getAllByRole("button")
        .map(button => button.textContent),
    ).toEqual(["Accept", "Publish…", "Dismiss"]);
    expect(
      screen.getByText(/^About Ork itself: it has no lesson or fix/u),
    ).toBeDefined();
  });

  it("says a lesson can't go where its project has gone", async () => {
    await openFeedback({
      details: {
        [AGENTS]: {
          lessons: [
            {
              ok: false,
              workflow: "review-loop",
              error: "The project is gone.",
            },
          ],
          project: { ok: false, error: "The project is gone." },
        },
      },
    });
    await choose("AGENTS.md has no test command");
    expect(
      actions().getByRole("button", {
        name: "Add lesson…: The project is gone.",
      }),
    ).toBeDefined();
    expect(
      actions().getByRole("button", {
        name: "Propose fix…: The project is gone.",
      }),
    ).toBeDefined();
  });

  it("passes axe with an item chosen", async () => {
    const { view } = await openFeedback();
    await choose(LOOP_TITLE);
    expect(await violations(view.container)).toEqual([]);
  });
});

describe("dismissing, restoring and accepting", () => {
  it("dismisses an item: it leaves the list, and the next row takes the focus", async () => {
    const opened = await openFeedback();
    await choose(LOOP_TITLE);
    await userEvent.click(actions().getByRole("button", { name: "Dismiss" }));
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(
        rowOf("AGENTS.md has no test command"),
      );
    });
    expect(asked(opened, "status")).toEqual([
      { route: "status", id: LOOP, body: { status: "dismissed" } },
    ]);
    expect(
      screen.queryByRole("button", { name: /^The loop reviews/u }),
    ).toBeNull();
    expect(
      screen.getByRole("heading", { name: "AGENTS.md has no test command" }),
    ).toBeDefined();
    expect(announced(opened)).toBe(
      "Dismissed 9fae0c1d2e3f. It's listed under All and Dismissed.",
    );
  });

  it("keeps a dismissed item listed under All, the focus on Restore", async () => {
    const opened = await openFeedback();
    await pick("Status", "All · 3");
    await choose(LOOP_TITLE);
    const status = actions().getByRole("button", { name: "Dismiss" });
    await userEvent.click(status);
    await vi.waitFor(() => {
      expect(status.textContent).toBe("Restore");
    });
    expect(document.activeElement).toBe(status);
    await userEvent.click(status);
    await vi.waitFor(() => {
      expect(announced(opened)).toMatch(/Restored 9fae0c1d2e3f as new\.$/u);
    });
    expect(asked(opened, "status").map(call => call.body)).toEqual([
      { status: "dismissed" },
      { status: "new" },
    ]);
  });

  it("says a refused dismissal in a toast", async () => {
    await openFeedback({
      refuse: { status: { status: 404, error: "No feedback item." } },
    });
    await userEvent.click(rowOf(LOOP_TITLE));
    await settle();
    await userEvent.click(actions().getByRole("button", { name: "Dismiss" }));
    expect(
      await screen.findByText("Could not dismiss 9fae0c1d2e3f"),
    ).toBeDefined();
  });

  it("accepts an item, the focus staying on the button", async () => {
    const opened = await openFeedback();
    await choose(LOOP_TITLE);
    const accept = actions().getByRole("button", { name: "Accept" });
    await userEvent.click(accept);
    await vi.waitFor(() => {
      expect(announced(opened)).toBe("Accepted 9fae0c1d2e3f.");
    });
    expect(asked(opened, "accept")).toEqual([
      { route: "accept", id: LOOP, body: { lesson: false } },
    ]);
    expect(document.activeElement).toBe(accept);
  });

  it("splits the items merged into one back out", async () => {
    const opened = await openFeedback({
      items: [item(LOOP, { merged: [whole(MERGED)] })],
    });
    await choose("Title of 9fae0c1d2e3f");
    expect(screen.getByText(MERGED)).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Split" }));
    await vi.waitFor(() => {
      expect(announced(opened)).toBe("Split 1 item back out of 9fae0c1d2e3f.");
    });
    expect(asked(opened, "split")).toHaveLength(1);
    expect(document.activeElement?.tagName).toBe("H2");
    expect(await screen.findByText("2 items")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Split" })).toBeNull();
  });

  it("follows the chosen item into the one it was merged into", async () => {
    const opened = await openFeedback();
    await choose("AGENTS.md has no test command");
    opened.server.items = [
      item(LOOP, { title: LOOP_TITLE, merged: [whole(AGENTS)] }),
      item(ORK, { target: "ork" }),
    ];
    await userEvent.click(screen.getByRole("button", { name: /^Reload/u }));
    await vi.waitFor(() => {
      expect(announced(opened)).toBe(
        "17817ce9802a was merged into 9fae0c1d2e3f.",
      );
    });
    expect(
      await screen.findByRole("heading", { level: 2, name: LOOP_TITLE }),
    ).toBeDefined();
  });
});
