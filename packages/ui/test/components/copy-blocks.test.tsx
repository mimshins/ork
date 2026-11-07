/**
 * @file Tests for the key hint, the empty state and the copy-command block:
 *   each says what it means in words, a command is a block whose copy button
 *   works from the keyboard and says so, and each has no accessibility
 *   violations.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EmptyState } from "../../src/components/bits.tsx";
import { CopyCommand } from "../../src/components/copy-command.tsx";
import { Kbd } from "../../src/components/kbd.tsx";
import { violations } from "../axe.ts";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the small pieces", () => {
  it("the key hint marks each key, and passes axe", async () => {
    const { container } = render(<Kbd keys={["⌘", "K"]} />);
    expect(container.querySelectorAll("kbd")).toHaveLength(2);
    expect(await violations(container)).toEqual([]);
  });

  it("the empty state says what is missing and the next step, its command a block", async () => {
    const { container } = render(
      <EmptyState
        cli="ork run <workflow>"
        title="No runs yet."
      >
        Start one with Run workflow, or in a terminal:
      </EmptyState>,
    );
    expect(screen.getByText("No runs yet.")).toBeDefined();
    expect(screen.getByText("ork run <workflow>")).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Copy ork run <workflow>" }),
    ).toBeDefined();
    expect(await violations(container)).toEqual([]);
  });
});

/** Jsdom has no clipboard: gives the page one that does `writeText`. */
const stubClipboard = (writeText: (text: string) => Promise<void>) => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
};

describe("the copy-command field", () => {
  it("copies from the keyboard, says so, and passes axe", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(() =>
      Promise.resolve(),
    );
    stubClipboard(writeText);
    const { container } = render(<CopyCommand command="ork logs 4f2a1c" />);
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    expect(writeText).toHaveBeenCalledWith("ork logs 4f2a1c");
    expect((await screen.findByRole("status")).textContent).toBe("Copied.");
    expect(await violations(container)).toEqual([]);
  });

  it("says it again when copied again", async () => {
    stubClipboard(() => Promise.resolve());
    render(<CopyCommand command="ork logs 4f2a1c" />);
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    const status = await screen.findByRole("status");
    await vi.waitFor(() => {
      expect(status.textContent).toBe("Copied.");
    });
    const first = status.firstElementChild;
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => {
      expect(status.firstElementChild).not.toBe(first);
    });
    expect(status.textContent).toBe("Copied.");
  });

  it("says what to do when the copy fails", async () => {
    stubClipboard(() => Promise.reject(new Error("denied")));
    render(<CopyCommand command="ork logs 4f2a1c" />);
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe(
        "Copy failed: select the text instead.",
      );
    });
  });
});
