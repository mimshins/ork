/**
 * @file Tests for the new-version banner in the page: its words and its one
 *   button for each state, from the server's record and its upgrade; dismissed
 *   for a day, saying where Upgrade Ork… is; said aloud only when it appears
 *   mid-session; never focused on its own; and axe-clean.
 */

import { act, cleanup, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { violations } from "../axe.ts";
import { stubWindow } from "../dom.ts";
import { JOB, NOTES, VERSION } from "./upgrade-fake.ts";
import { announced, banner, connect, openUpgrade } from "./upgrade-harness.tsx";

beforeEach(() => {
  localStorage.clear();
  stubWindow();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const shown = () => {
  const region = banner();
  if (region === null) throw new Error("No banner.");
  return within(region);
};

describe("the banner", () => {
  it("says a newer version in the CLI's words, with what changed and Upgrade…", async () => {
    const opened = openUpgrade();
    await connect(opened);
    await vi.waitFor(() => {
      expect(banner()?.textContent).toContain(
        "Ork 0.4.0 is out (you have 0.3.0).",
      );
    });
    const link = shown().getByRole("link", {
      // jsdom joins the hidden words without the spaces a browser keeps.
      name: /^What changed\s*in 0\.4\.0\s*\(opens in a new tab\)$/u,
    });
    expect(link.getAttribute("href")).toBe(NOTES);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(shown().getByRole("button", { name: "Upgrade…" })).toBeTruthy();
    expect(await violations(opened.container)).toEqual([]);
    // Present at load, so not news; and the focus never moves to it.
    expect(announced(opened)).toEqual([]);
    expect(document.activeElement).toBe(document.body);
  });

  it("shows nothing when the check is off", async () => {
    const opened = openUpgrade();
    await connect(opened, {
      ...VERSION,
      newer: null,
      releaseNotes: null,
      check: { on: false, reason: "CI is set" },
    });
    expect(banner()).toBeNull();
  });

  it("says a version that appears while the page is open, once", async () => {
    const opened = openUpgrade();
    await connect(opened, { ...VERSION, newer: null, releaseNotes: null });
    expect(banner()).toBeNull();
    act(() => {
      opened.overview.send("version", VERSION);
    });
    await vi.waitFor(() => {
      expect(banner()).not.toBeNull();
    });
    expect(announced(opened)).toEqual([
      "Ork 0.4.0 is out. Upgrade… is above the panels.",
    ]);
  });

  it("hides for a day when dismissed, and says where to find it", async () => {
    const user = userEvent.setup();
    const opened = openUpgrade();
    await connect(opened);
    await user.click(
      await screen.findByRole("button", { name: "Dismiss for a day" }),
    );
    expect(banner()).toBeNull();
    expect(announced(opened)).toEqual([
      "Dismissed for a day. Upgrade Ork… is in Commands.",
    ]);
    expect(
      opened.state.preferences.value.getValue().updateDismissed?.version,
    ).toBe("0.4.0");
    act(() => {
      opened.overview.send("version", {
        ...VERSION,
        latest: "0.5.0",
        newer: "0.5.0",
      });
    });
    await vi.waitFor(() => {
      expect(banner()?.textContent).toContain("Ork 0.5.0 is out");
    });
  });

  it("sits between the top bar and the panels, and gives the focus to the panels when dismissed", async () => {
    stubWindow(false);
    const user = userEvent.setup();
    const opened = openUpgrade({ shell: true, wide: false });
    await connect(opened);
    const region = await screen.findByRole("region", { name: "New version" });
    const header = screen.getByRole("button", { name: /Commands/u });
    const main = screen.getByRole("main");
    expect(header.compareDocumentPosition(region)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(region.compareDocumentPosition(main)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    await user.click(
      within(region).getByRole("button", { name: "Dismiss for a day" }),
    );
    expect(document.activeElement?.id).toBe("stack-runs");
  });

  it("shows another tab's upgrade, and opens the dialog on it", async () => {
    const user = userEvent.setup();
    const opened = openUpgrade();
    await connect(opened, { ...VERSION, job: JOB });
    await vi.waitFor(() => {
      expect(banner()?.textContent).toContain("Upgrading Ork to 0.4.0…");
    });
    await user.click(shown().getByRole("button", { name: "Show output" }));
    expect(
      await screen.findByRole("dialog", { name: "Upgrading Ork to 0.4.0" }),
    ).toBeTruthy();
    expect(opened.state.version.dialog.getValue()).toBe("job");
  });

  it("offers Restart… once installed, and the reason when it failed", async () => {
    const opened = openUpgrade();
    await connect(opened, {
      ...VERSION,
      job: { ...JOB, state: "succeeded", code: 0 },
    });
    await vi.waitFor(() => {
      expect(banner()?.textContent).toContain(
        "Ork 0.4.0 is installed. ork ui still runs 0.3.0 until it restarts.",
      );
    });
    expect(shown().getByRole("button", { name: "Restart…" })).toBeTruthy();
    act(() => {
      opened.overview.send("version", {
        ...VERSION,
        job: { ...JOB, state: "failed", code: 1 },
      });
    });
    await vi.waitFor(() => {
      expect(banner()?.textContent).toContain(
        "The upgrade to 0.4.0 did not finish: exit 1.",
      );
    });
    expect(await violations(opened.container)).toEqual([]);
  });

  it("offers only a reload to a page older than its server", async () => {
    const opened = openUpgrade({ pageVersion: "0.2.0" });
    await connect(opened);
    await vi.waitFor(() => {
      expect(banner()?.textContent).toContain(
        "This page is from Ork 0.2.0; ork ui now runs 0.3.0.",
      );
    });
    expect(
      shown()
        .getAllByRole("button")
        .map(button => button.textContent),
    ).toEqual(["Reload"]);
  });
});
