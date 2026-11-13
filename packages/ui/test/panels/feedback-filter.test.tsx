/**
 * @file Tests for the Feedback panel's filter bar: the shared bar on the
 *   `feedback` list with its default (not dismissed) and About beside it; a
 *   field's change reads again with the table's query; a value the server
 *   refuses shows its words inline and keeps the list; Clear filter resets; the
 *   matching command shows while a filter is set.
 */

import { cleanup, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { stubWindow } from "../dom.ts";
import {
  asked,
  openFeedback,
  type OpenedFeedback,
  pick,
} from "./feedback-harness.tsx";

beforeEach(() => {
  localStorage.clear();
  stubWindow();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The query of the list read last. */
const lastQuery = (opened: OpenedFeedback): unknown =>
  asked(opened, "list").at(-1)?.body;

const waitForQuery = async (
  opened: OpenedFeedback,
  query: unknown,
): Promise<void> => {
  await vi.waitFor(() => {
    expect(lastQuery(opened)).toEqual(query);
  });
};

/** Presses the first button of that name, the bar's. */
const clickFirst = async (name: string): Promise<void> => {
  await Promise.all(
    screen
      .getAllByRole("button", { name })
      .slice(0, 1)
      .map(button => userEvent.click(button)),
  );
};

describe("the Feedback panel's filter bar", () => {
  it("shows the bar with the default, About beside it, and no filter set", async () => {
    await openFeedback();
    expect(
      screen.getByRole("search", { name: "Filter feedback" }),
    ).toBeDefined();
    expect(
      screen.getByRole("combobox", { name: "Status" }).textContent,
    ).toContain("Default (not dismissed)");
    for (const name of ["Kind", "Severity", "Workflow", "Run", "About"]) {
      expect(screen.getByRole("combobox", { name })).toBeDefined();
    }
    expect(screen.queryByRole("button", { name: "Clear filter" })).toBeNull();
    expect(screen.getByText("3 items")).toBeDefined();
  });

  it("reads again with the field's query, and shows the count and the command", async () => {
    const opened = await openFeedback();
    expect(lastQuery(opened)).toEqual({});
    await pick("Status", "new");
    await waitForQuery(opened, { status: "new" });
    expect(await screen.findByText("3 feedback items match.")).toBeDefined();
    expect(screen.getByText("ork feedback list --status new")).toBeDefined();
  });

  it("applies a text field on Enter", async () => {
    const opened = await openFeedback();
    await userEvent.type(
      screen.getByRole("combobox", { name: "Workflow" }),
      "review-loop{Enter}",
    );
    await waitForQuery(opened, { workflow: "review-loop" });
    expect(
      screen.getByText("ork feedback list --workflow review-loop"),
    ).toBeDefined();
  });

  it("says a refused value inline, on its field, and keeps the list", async () => {
    const opened = await openFeedback();
    opened.server.refuse = {
      list: {
        status: 400,
        error: "--workflow takes a workflow's name, not `a b`.",
      },
    };
    await userEvent.type(
      screen.getByRole("combobox", { name: "Workflow" }),
      "a b{Enter}",
    );
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(
      "--workflow takes a workflow's name, not a b. The list shows the last filter that worked. Fix the value, or clear the filter.",
    );
    expect(
      screen
        .getByRole("combobox", { name: "Workflow" })
        .getAttribute("aria-invalid"),
    ).toBe("true");
    expect(
      screen.queryByText("Could not read feedback:", { exact: false }),
    ).toBeNull();
    expect(
      within(screen.getByRole("list", { name: "Feedback items" })).getAllByRole(
        "button",
      ),
    ).toHaveLength(3);
  });

  it("clears every field with Clear filter and reads the default again", async () => {
    const opened = await openFeedback();
    await pick("Status", "new");
    await waitForQuery(opened, { status: "new" });
    await userEvent.click(
      await screen.findByRole("button", { name: "Clear filter" }),
    );
    await waitForQuery(opened, {});
    expect(screen.queryByText("ork feedback list --status new")).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear filter" })).toBeNull();
  });

  it("says nothing matches, with Clear filter, when the filter leaves no item", async () => {
    await openFeedback();
    await pick("Status", "triaged");
    expect(
      await screen.findByText("No feedback items match the filter."),
    ).toBeDefined();
    // One in the bar, one in the empty state: both clear.
    await clickFirst("Clear filter");
    expect(await screen.findByText("Filter cleared.")).toBeDefined();
    expect(
      screen.queryByText("No feedback items match the filter."),
    ).toBeNull();
  });
});
