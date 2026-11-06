/**
 * @file Tests for a note from the Monitor, on a fake server: a node's Note…
 *   button is named for the node and disabled with its reason for one that
 *   never ran; the dialog's choices are lists, a bad rating raises the
 *   severity, the CLI twin follows them, a refusal stays in it, and a note
 *   added names the item it joined. The run's own note sits in its controls.
 */

import { cleanup, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { violations } from "../axe.ts";
import { stubWindow } from "../dom.ts";
import { describedBy, openNote as open, pick } from "./feedback-harness.tsx";

const noteDialog = () =>
  within(screen.getByRole("dialog", { name: /^Note on/u }));

beforeEach(() => {
  localStorage.clear();
  stubWindow();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("a note on a node", () => {
  it("is named for the node, with its CLI twin", () => {
    open("reviews");
    const button = screen.getByRole("button", { name: "Note on reviews" });
    expect(button.getAttribute("aria-description")).toBe(
      "CLI: ork feedback note aaa11111 reviews -m <text>",
    );
  });

  it("is disabled, and says why, for a node that never ran", () => {
    open("reviews", {}, { enabled: false, why: "it hasn't run" });
    const button = screen.getByRole("button", {
      name: "Note on reviews: it hasn't run",
    });
    expect(button.getAttribute("aria-disabled")).toBe("true");
  });

  it("adds what was written, its rating raising the severity", async () => {
    const { server } = open("reviews");
    await userEvent.click(
      screen.getByRole("button", { name: "Note on reviews" }),
    );
    const note = await screen.findByRole("textbox", { name: /^Note/u });
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(note);
    });
    const add = noteDialog().getByRole("button", { name: "Add note" });
    expect(describedBy(add)).toBe("Write the note first.");
    const severity = noteDialog().getByRole("combobox", { name: "Severity" });
    // There before it has words, so the words it gets are heard.
    expect(severity.getAttribute("aria-describedby")).not.toBeNull();
    expect(describedBy(severity)).toBe("");
    await userEvent.type(note, "Missed the failing test");
    expect(describedBy(add)).toBe("");
    await pick("Rating", "bad");
    expect(severity.textContent).toBe("high");
    expect(describedBy(severity)).toBe("Severity: high, from the bad rating.");
    expect(
      noteDialog().getByText(
        "ork feedback note aaa11111 reviews -m 'Missed the failing test' --rating bad",
      ),
    ).toBeDefined();
    expect(await violations(document.body)).toEqual([]);
    await userEvent.click(
      noteDialog().getByRole("button", { name: "Add note" }),
    );
    expect(await screen.findByText(/^Noted on/u)).toBeDefined();
    expect(screen.getByText(/^It joined item/u).textContent).toBe(
      "It joined item 9fae0c1d2e3f.",
    );
    expect(server.asked).toEqual([
      {
        route: "note",
        id: "aaa11111",
        body: {
          text: "Missed the failing test",
          node: "reviews",
          kind: "friction",
          severity: "high",
          rating: "bad",
        },
      },
    ]);
  });

  it("adds it with ⌘Enter, and keeps a refusal in the dialog", async () => {
    open("reviews", {
      note: { status: 400, error: "No node reviews ran in run aaa11111." },
    });
    await userEvent.click(
      screen.getByRole("button", { name: "Note on reviews" }),
    );
    const note = await screen.findByRole("textbox", { name: /^Note/u });
    await userEvent.type(note, "Slow");
    await userEvent.keyboard("{Meta>}{Enter}{/Meta}");
    expect((await noteDialog().findByRole("alert")).textContent).toBe(
      "Could not add the note: No node reviews ran in run aaa11111.",
    );
  });
});

describe("a note on a run", () => {
  it("sits among the run's controls, and leaves the node out", async () => {
    const { server } = open();
    const controls = within(
      screen.getByRole("group", { name: "Run controls" }),
    );
    await userEvent.click(
      controls.getByRole("button", { name: "Note on run aaa11111" }),
    );
    expect(
      await screen.findByRole("dialog", { name: "Note on run aaa11111" }),
    ).toBeDefined();
    await pick("Kind", "idea");
    await userEvent.type(
      noteDialog().getByRole("textbox", { name: /^Note/u }),
      "Cache the build",
    );
    expect(
      noteDialog().getByText(
        "ork feedback note aaa11111 -m 'Cache the build' --kind idea",
      ),
    ).toBeDefined();
    await userEvent.click(
      noteDialog().getByRole("button", { name: "Add note" }),
    );
    await vi.waitFor(() => {
      expect(server.asked.map(call => call.body)).toEqual([
        { text: "Cache the build", kind: "idea", severity: "medium" },
      ]);
    });
  });
});
