/**
 * @file Tests for the end badge, the end note and its Details: each actor has a
 *   tone, a kind that may pass says so in words, the raw details are closed
 *   until asked for and shown exactly as stored, and there are no accessibility
 *   violations.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EndBadge, endStatusOf } from "../../src/components/end-badge.tsx";
import { EndNote } from "../../src/components/end-note.tsx";
import { violations } from "../axe.ts";
import {
  DONE,
  OUT_OF_CREDITS,
  RATE_LIMITED,
  TURN_LIMIT,
  UNKNOWN,
} from "../ends.ts";

afterEach(() => {
  cleanup();
});

describe("the end badge", () => {
  it("tones every actor, and says it in words", () => {
    expect(
      (
        ["agent", "workflow", "ork", "account", "provider", "user"] as const
      ).map(actor => endStatusOf(actor)),
    ).toEqual([
      "failed",
      "failed",
      "failed",
      "waiting",
      "interrupted",
      "interrupted",
    ]);
    render(<EndBadge end={OUT_OF_CREDITS} />);
    expect(screen.getByText("Out of credits")).toBeDefined();
  });

  it("is none for a node that finished well, and says when it may pass", () => {
    const { container, rerender } = render(<EndBadge end={DONE} />);
    expect(container.textContent).toBe("");
    rerender(<EndBadge end={TURN_LIMIT} />);
    expect(container.textContent).not.toContain("may pass");
    rerender(<EndBadge end={RATE_LIMITED} />);
    expect(container.textContent).toContain("Rate limited");
    expect(container.textContent).toContain(", may pass");
  });
});

const note = (end = RATE_LIMITED) =>
  render(
    <EndNote
      end={end}
      node="build"
      runId="aaa11111"
    />,
  );

describe("the end note", () => {
  it("tells the story: message, what to do, who acts, the guide", () => {
    note();
    const group = screen.getByRole("group", { name: "How build ended" });
    expect(group.textContent).toContain(
      "build was asked by its provider to slow down.",
    );
    expect(group.querySelector("code")?.textContent).toBe("build");
    expect(group.textContent).toContain("ork resume");
    expect(group.textContent).toContain("the provider");
    const link = screen.getByRole("link", { name: /Why a node stops/u });
    expect(link.getAttribute("href")).toMatch(
      /why-a-node-stopped\.md#rate-limited$/u,
    );
    expect(link.getAttribute("rel")).toBe("noreferrer");
  });

  it("keeps the details closed, opens them from the start, and copies", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn<() => Promise<void>>(async () => {}) },
    });
    note();
    const button = screen.getByRole("button", { name: "Details" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("region", { name: /Raw details/u })).toBeNull();
    await userEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const well = screen.getByRole("region", { name: "Raw details of build" });
    expect(well.textContent).toBe(RATE_LIMITED.detail);
    expect(well.tabIndex).toBe(0);
    expect(screen.getByText("Scrubbed. At most 4 KiB.")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Copy details" }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      RATE_LIMITED.detail,
    );
    await userEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    vi.unstubAllGlobals();
  });

  it("has no Details without a detail, and none at all for done", () => {
    note(TURN_LIMIT);
    expect(screen.queryByRole("button", { name: "Details" })).toBeNull();
    cleanup();
    const { container } = note(DONE);
    expect(container.textContent).toBe("");
  });

  it("names who acts, Ork included", () => {
    note(UNKNOWN);
    expect(screen.getByText("Who acts").nextElementSibling?.textContent).toBe(
      "Ork",
    );
  });

  it("passes axe, with the details open", async () => {
    const { container } = note();
    await userEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(await violations(container)).toEqual([]);
  });
});
