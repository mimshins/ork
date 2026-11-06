/**
 * @file Tests that the Feedback panel's controls are named by what they show
 *   (WCAG 2.5.3): each row's accessible name holds every word seen on it, in
 *   order, with the words only a screen reader needs added; and two records'
 *   Open run buttons never share a name. jsdom's axe can't check this (it has
 *   no layout to tell what's seen), and jsdom names an `aria-hidden` part where
 *   a browser doesn't, so the words a browser speaks are read here too.
 */

import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { stubWindow } from "../dom.ts";
import { LOOP, record } from "./feedback-fixtures.ts";
import { choose, openFeedback } from "./feedback-harness.tsx";

const LOOP_TITLE = "The loop reviews -> lead ran out of its 2 rounds";

/** Words as compared: spaces collapsed, since only their order counts. */
const tidy = (text: string): string => text.replaceAll(/\s+/gu, " ").trim();

const hiddenFromEyes = (node: Node): boolean =>
  node.parentElement?.closest('[class*="visuallyHidden"]') !== null;

const hiddenFromReaders = (node: Node): boolean =>
  node.parentElement?.closest('[aria-hidden="true"]') !== null;

/** The text nodes under an element that pass `keep`, in order. */
const textsOf = (element: Element, keep: (node: Node) => boolean): string[] => {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const texts: string[] = [];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = tidy(node.textContent ?? "");
    if (text !== "" && keep(node)) texts.push(text);
  }
  return texts;
};

/** What the eye reads that a screen reader hears too, piece by piece. */
const seenAndSpoken = (element: Element): string[] =>
  textsOf(element, node => !hiddenFromEyes(node) && !hiddenFromReaders(node));

/** The name a browser computes from the content: no `aria-hidden` part. */
const spokenName = (element: Element): string =>
  tidy(textsOf(element, node => !hiddenFromReaders(node)).join(" "));

/** Whether `pieces` all appear in `name`, in this order. */
const inOrder = (name: string, pieces: readonly string[]): boolean => {
  let from = 0;
  for (const piece of pieces) {
    const at = name.indexOf(piece, from);
    if (at === -1) return false;
    from = at + piece.length;
  }
  return true;
};

/** Each element's name as testing-library computes it. */
const namesOf = (elements: readonly HTMLElement[]): string[] =>
  elements.map(element => {
    let name = "";
    within(element.parentElement ?? document.body).getAllByRole("button", {
      name: (computed, found) => {
        if (found === element) name = computed;
        return found === element;
      },
    });
    return tidy(name);
  });

const rows = (): HTMLElement[] =>
  within(screen.getByRole("list", { name: "Feedback items" })).getAllByRole(
    "button",
  );

/** Whether each row's name holds what it shows, in order. */
const rowsHoldWhatTheyShow = (): boolean[] => {
  const shown = rows();
  const names = namesOf(shown);
  return shown.map((row, at) => inOrder(names[at] ?? "", seenAndSpoken(row)));
};

const firstRowSpoken = (): string => spokenName(rows()[0] ?? document.body);

beforeEach(() => {
  localStorage.clear();
  stubWindow();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the Feedback panel's names", () => {
  it("names each row with every word it shows, in order", async () => {
    await openFeedback();
    expect(rowsHoldWhatTheyShow()).toEqual([true, true, true]);
    expect(rows().map(row => row.hasAttribute("aria-label"))).toEqual([
      false,
      false,
      false,
    ]);
  });

  it("says a row's count and time in words, as a browser speaks it", async () => {
    await openFeedback();
    const spoken = firstRowSpoken();
    expect(spoken).toMatch(
      /^The loop reviews -> lead ran out of its 2 rounds , new , 9fae0c1d2e3f , 3 times , workflow · friction , high , last seen /u,
    );
    expect(spoken).not.toContain("×");
  });

  it("names two records' Open run apart, the words seen first", async () => {
    await openFeedback({
      details: {
        [LOOP]: {
          records: [
            record(LOOP, { title: LOOP_TITLE }, { id: 1 }),
            record(
              LOOP,
              { title: LOOP_TITLE },
              { id: 2, seq: 9, at: "2026-11-04T12:06:00.000Z" },
            ),
          ],
        },
      },
    });
    await choose(LOOP_TITLE);
    const buttons = screen.getAllByRole("button", { name: /^Open run/u });
    const names = buttons.map(button => spokenName(button));
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
    expect(
      names.every(name => name.startsWith("Open run 4f2a1c00 at reviews,")),
    ).toBe(true);
  });
});
