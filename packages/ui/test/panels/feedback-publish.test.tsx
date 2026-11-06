/**
 * @file Tests for the publish dialog's states and what ties its words to its
 *   controls: a failed post takes the focus to Try again; a failed read keeps
 *   the text before in view, says it's from the last read, and fills a line
 *   kept for it; Post and the names checkbox are described by their reason and
 *   hint; and the posted and failed states pass axe.
 */

import { cleanup, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { violations } from "../axe.ts";
import { stubWindow } from "../dom.ts";
import { PREVIEW } from "./feedback-fixtures.ts";
import {
  actions,
  choose,
  describedBy,
  openFeedback,
} from "./feedback-harness.tsx";

const ORK_TITLE = "`feedback` tool error: invalid evidence";

const dialog = () => within(screen.getByRole("dialog", { name: /^Publish /u }));

const openPublish = async (over: Parameters<typeof openFeedback>[0] = {}) => {
  const opened = await openFeedback(over);
  await choose(ORK_TITLE);
  await userEvent.click(actions().getByRole("button", { name: "Publish…" }));
  await screen.findByRole("dialog", { name: /^Publish /u });
  return opened;
};

const readDone = async (): Promise<void> => {
  await vi.waitFor(() => {
    expect(
      screen.getByRole("region", { name: "Text to post" }).textContent,
    ).toBe(PREVIEW.post.body);
  });
};

const hideNames = () =>
  dialog().getByRole("checkbox", {
    name: "Hide repository and workflow names",
  });

beforeEach(() => {
  localStorage.clear();
  stubWindow();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the publish dialog's words and focus", () => {
  it("ties the names hint to its checkbox, and Post to what holds it back", async () => {
    await openPublish();
    expect(describedBy(hideNames())).toBe(
      "Your workflows' and projects' folders' names become <name>.",
    );
    await readDone();
    const post = dialog().getByRole("button", { name: "Post thread" });
    expect(describedBy(post)).toBe("");
  });

  it("keeps a line for a failure, which a failed post fills, and takes the focus to Try again", async () => {
    await openPublish({
      refuse: { publish: { status: 400, error: "gh failed: no network" } },
    });
    await readDone();
    const slot = dialog().getByRole("alert");
    expect(slot.textContent).toBe("");
    await userEvent.click(
      dialog().getByRole("button", { name: "Post thread" }),
    );
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(
        dialog().getByRole("button", { name: "Try again" }),
      );
    });
    expect(slot.textContent).toBe("Could not post: gh failed: no network.");
    expect(
      describedBy(dialog().getByRole("button", { name: "Post thread" })),
    ).toBe("Could not post: gh failed: no network.");
    expect(await violations(document.body)).toEqual([]);
  });

  it("keeps the text before when a read fails, and says it's from the last read", async () => {
    await openPublish({ previews: [PREVIEW, "gh failed: not logged in"] });
    await readDone();
    const box = hideNames();
    await userEvent.click(box);
    expect((await dialog().findByRole("alert")).textContent).toMatch(
      /^Could not read Ork's Discussions: gh failed: not logged in/u,
    );
    const text = dialog().getByRole("region", { name: "Text to post" });
    expect(text.textContent).toBe(PREVIEW.post.body);
    expect(describedBy(text)).toBe("From the last read");
    expect(document.activeElement).toBe(box);
    expect(await violations(document.body)).toEqual([]);
  });

  it("says where a post went, and passes axe", async () => {
    await openPublish();
    await readDone();
    await userEvent.click(
      dialog().getByRole("button", { name: "Post thread" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Posted" }),
    ).toBeDefined();
    expect(await violations(document.body)).toEqual([]);
  });
});
