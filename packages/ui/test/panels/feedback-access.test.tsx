/**
 * @file Tests for the Feedback panel's keyboard and focus: Escape in the detail
 *   goes back to the item's row; a narrow panel shows the detail in the list's
 *   place, its heading taking the focus, with Back to items; and dismissing the
 *   last item leaves the focus in the list, never on the page.
 */

import { cleanup, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { violations } from "../axe.ts";
import { stubWindow } from "../dom.ts";
import { item, LOOP } from "./feedback-fixtures.ts";
import {
  actions,
  choose,
  openFeedback,
  rowOf,
  stubWidth,
} from "./feedback-harness.tsx";

const LOOP_TITLE = "The loop reviews -> lead ran out of its 2 rounds";

beforeEach(() => {
  localStorage.clear();
  stubWindow();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the Feedback panel, wide", () => {
  it("goes back to the item's row on Escape, once a tip is closed", async () => {
    await openFeedback();
    await choose(LOOP_TITLE);
    const accept = actions().getByRole("button", { name: "Accept" });
    accept.focus();
    // The focus opened the button's tip: the first Escape is the tip's.
    await userEvent.keyboard("{Escape}");
    expect(document.activeElement).toBe(accept);
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(rowOf(LOOP_TITLE));
    });
  });

  it("keeps the focus in the list when the last item is dismissed", async () => {
    await openFeedback({ items: [item(LOOP)] });
    await choose("Title of 9fae0c1d2e3f");
    await userEvent.click(actions().getByRole("button", { name: "Dismiss" }));
    await vi.waitFor(() => {
      expect(document.activeElement?.getAttribute("aria-label")).toBe("Items");
    });
    expect(screen.getByText("Every item is dismissed.")).toBeDefined();
  });
});

describe("the Feedback panel, narrow", () => {
  it("shows the chosen item in the list's place, and goes back", async () => {
    stubWidth(400);
    const { view } = await openFeedback();
    await vi.waitFor(() => {
      expect(
        view.container.querySelector('[data-layout="narrow"]'),
      ).not.toBeNull();
    });
    await userEvent.click(rowOf(LOOP_TITLE));
    const heading = await screen.findByRole("heading", {
      level: 2,
      name: LOOP_TITLE,
    });
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(heading);
    });
    expect(screen.queryByRole("list", { name: "Feedback items" })).toBeNull();
    expect(await violations(view.container)).toEqual([]);
    await userEvent.click(
      screen.getByRole("button", { name: "Back to items" }),
    );
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(rowOf(LOOP_TITLE));
    });
  });

  it("goes back to the list on Escape too", async () => {
    stubWidth(400);
    await openFeedback();
    await userEvent.click(rowOf(LOOP_TITLE));
    await screen.findByRole("button", { name: "Back to items" });
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(rowOf(LOOP_TITLE));
    });
  });
});
