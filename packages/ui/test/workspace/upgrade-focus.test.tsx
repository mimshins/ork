/**
 * @file Tests for where the Upgrade dialog puts the focus, and for axe at the
 *   steps the flow tests don't stop at: closed, it hands the focus to the
 *   banner's button, or to the panels when the banner has none; opened from the
 *   palette, it keeps the focus on Cancel; Try again hands it to Cancel while
 *   it asks; and the registry it couldn't reach is the one it named. jsdom has
 *   no layout or Base UI's frame-late focus moves, so the browser check covers
 *   the race these guard against.
 */

import { act, cleanup, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { violations } from "../axe.ts";
import { stubWindow } from "../dom.ts";
import { JOB, VERSION } from "./upgrade-fake.ts";
import {
  banner,
  connect,
  dialog,
  openUpgrade,
  type Opened,
} from "./upgrade-harness.tsx";

beforeEach(() => {
  localStorage.clear();
  stubWindow();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const focused = () => document.activeElement;

/** A few frames, for focus moves Base UI and the steps make a frame late. */
const frames = () =>
  act(async () => {
    await new Promise(resolve => {
      setTimeout(resolve, 100);
    });
  });

const bannerButton = (name: string) => {
  const region = banner();
  if (region === null) throw new Error("No banner.");
  return within(region).getByRole("button", { name });
};

const openAsk = async (opened: Opened) => {
  await connect(opened);
  act(() => {
    opened.state.version.openDialog("ask");
  });
  return screen.findByRole("dialog", { name: "Upgrade Ork" });
};

describe("the focus, closing", () => {
  it("goes back to the banner's Upgrade… after Cancel", async () => {
    const user = userEvent.setup();
    const opened = openUpgrade();
    await connect(opened);
    await user.click(bannerButton("Upgrade…"));
    await dialog().findByText("Command");
    await user.click(dialog().getByRole("button", { name: "Cancel" }));
    await vi.waitFor(() => {
      expect(focused()).toBe(bannerButton("Upgrade…"));
    });
  });

  it("goes back to Restart… after opening on the finished upgrade", async () => {
    const user = userEvent.setup();
    const opened = openUpgrade();
    await connect(opened, {
      ...VERSION,
      job: { ...JOB, state: "succeeded", code: 0 },
    });
    await user.click(await vi.waitFor(() => bannerButton("Restart…")));
    await dialog().findByRole("heading", { name: "Upgraded to 0.4.0" });
    await user.click(dialog().getByRole("button", { name: "Later" }));
    await vi.waitFor(() => {
      expect(focused()).toBe(bannerButton("Restart…"));
    });
  });

  it("goes to the panels when the banner went, as after the latest", async () => {
    stubWindow(false);
    const user = userEvent.setup();
    const opened = openUpgrade({
      shell: true,
      wide: false,
      plans: [{ kind: "latest", current: "0.3.0" }],
    });
    opened.server.version = { ...VERSION, newer: null, latest: "0.3.0" };
    await openAsk(opened);
    await dialog().findByRole("heading", {
      name: "Ork 0.3.0 is the latest version.",
    });
    expect(await violations(document.body)).toEqual([]);
    await vi.waitFor(() => {
      expect(banner()).toBeNull();
    });
    await user.click(dialog().getByRole("button", { name: "Close" }));
    await vi.waitFor(() => {
      expect(focused()?.id).toBe("stack-runs");
    });
  });
});

describe("the focus, opening from the palette", () => {
  it("stays on Cancel, in front of the page", async () => {
    const user = userEvent.setup();
    const opened = openUpgrade({ shell: true });
    await connect(opened);
    await user.keyboard("{Control>}k{/Control}");
    await screen.findByRole("dialog", { name: "Command palette" });
    await vi.waitFor(() => {
      expect(focused()?.getAttribute("aria-label")).toBe("Search commands");
    });
    await user.keyboard("upgrade ork{Enter}");
    const upgrade = await screen.findByRole("dialog", { name: "Upgrade Ork" });
    const cancel = within(upgrade).getByRole("button", { name: "Cancel" });
    await vi.waitFor(() => {
      expect(focused()).toBe(cancel);
    });
    await frames();
    expect(focused()).toBe(cancel);
    expect(upgrade.getAttribute("aria-modal")).toBe("true");
  });
});

describe("Try again", () => {
  it("hands the focus to Cancel while it asks, and names the registry", async () => {
    const user = userEvent.setup();
    const opened = openUpgrade({
      plans: [{ kind: "unreachable" }],
      version: { ...VERSION, registry: "https://npm.example.test" },
    });
    await openAsk(opened);
    const words =
      "Could not reach the registry at https://npm.example.test to look for a new version.";
    expect((await dialog().findByRole("alert")).textContent).toBe(words);
    expect(await violations(document.body)).toEqual([]);
    // Close while nothing can run, Cancel while it asks: one button.
    const close = dialog().getByRole("button", { name: "Close" });
    await user.click(dialog().getByRole("button", { name: "Try again" }));
    expect(focused()).toBe(close);
    await dialog().findByRole("alert");
    await frames();
    expect(focused()).toBe(close);
  });
});

describe("axe, at the steps between", () => {
  it("passes while it asks the registry", async () => {
    const held = Promise.withResolvers<void>();
    const opened = openUpgrade({ planHold: held.promise });
    await openAsk(opened);
    expect(
      dialog().getByRole("region", { name: "Asking" }).textContent,
    ).toContain("Asking the npm registry");
    expect(await violations(document.body)).toEqual([]);
    held.resolve();
    await dialog().findByText("Command");
  });

  it("passes on the running and page-older banners", async () => {
    const running = openUpgrade();
    await connect(running, { ...VERSION, job: JOB });
    await vi.waitFor(() => {
      expect(banner()?.textContent).toContain("Upgrading Ork to 0.4.0…");
    });
    expect(await violations(running.container)).toEqual([]);
    cleanup();
    const older = openUpgrade({ pageVersion: "0.2.0" });
    await connect(older);
    await vi.waitFor(() => {
      expect(banner()?.textContent).toContain("This page is from Ork 0.2.0");
    });
    expect(await violations(older.container)).toEqual([]);
  });
});
