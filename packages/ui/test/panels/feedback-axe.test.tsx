/**
 * @file Accessibility checks of the Feedback panel's states that had none: the
 *   empty list and the narrow list, the Add lesson dialog with its Add button
 *   described by what holds it back, and the Propose fix confirmation. jsdom
 *   has no layout, so contrast, zoom and label-in-name are checked elsewhere
 *   (the token tests, a browser, feedback-names.test.tsx).
 */

import { cleanup, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { violations } from "../axe.ts";
import { stubWindow } from "../dom.ts";
import { item, LOOP } from "./feedback-fixtures.ts";
import {
  actions,
  choose,
  describedBy,
  openFeedback,
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

describe("the Feedback panel's states, by axe", () => {
  it("passes with no feedback at all", async () => {
    const { view } = await openFeedback({ items: [] });
    expect(screen.getByText("No feedback yet.")).toBeDefined();
    expect(await violations(view.container)).toEqual([]);
  });

  it("passes with the list in a narrow panel", async () => {
    stubWidth(400);
    const { view } = await openFeedback();
    await vi.waitFor(() => {
      expect(
        view.container.querySelector('[data-layout="narrow"]'),
      ).not.toBeNull();
    });
    expect(screen.getByRole("list", { name: "Feedback items" })).toBeDefined();
    expect(await violations(view.container)).toEqual([]);
  });

  it("passes with Add lesson open, its Add described by what it waits for", async () => {
    await openFeedback({
      items: [item(LOOP, { workflows: ["review-loop", "build"] })],
    });
    await choose("Title of 9fae0c1d2e3f");
    await userEvent.click(
      actions().getByRole("button", { name: "Add lesson…" }),
    );
    const lesson = await screen.findByRole("dialog", { name: "Add a lesson" });
    expect(
      describedBy(within(lesson).getByRole("button", { name: "Add lesson" })),
    ).toBe("Choose a workflow.");
    expect(await violations(document.body)).toEqual([]);
  });

  it("passes with the Propose fix confirmation open", async () => {
    await openFeedback();
    await choose(LOOP_TITLE);
    await userEvent.click(
      actions().getByRole("button", { name: "Propose fix…" }),
    );
    expect(await screen.findByRole("alertdialog")).toBeDefined();
    expect(await violations(document.body)).toEqual([]);
  });
});
