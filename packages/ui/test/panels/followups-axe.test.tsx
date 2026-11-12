/**
 * @file Accessibility checks of the Follow-ups panel by axe: the list, a chosen
 *   message with its draft, a task with its steps, the Post to GitHub
 *   confirmation and the empty and failed states; and the count in the rail's
 *   name. jsdom has no layout, so contrast, zoom and label-in-name are checked
 *   elsewhere (the token tests, a browser).
 */

import { cleanup, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Rail } from "../../src/workspace/rail.tsx";
import { createWorkspace } from "../../src/workspace/workspace.ts";
import { violations } from "../axe.ts";
import { stubWindow } from "../dom.ts";
import { choose, openFollowUps } from "./followups-harness.tsx";
import { renderPanel } from "./harness.tsx";

beforeEach(() => {
  localStorage.clear();
  stubWindow();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the Follow-ups panel, by axe", () => {
  it("passes with the list", async () => {
    const { view } = await openFollowUps();
    expect(await violations(view.container)).toEqual([]);
  });

  it("passes with a message and its draft chosen", async () => {
    const { view } = await openFollowUps();
    await choose("Message Acme about the webhook change");
    expect(await violations(view.container)).toEqual([]);
  });

  it("passes with a task and its steps chosen", async () => {
    const { view } = await openFollowUps();
    await choose("Run the migration");
    expect(await violations(view.container)).toEqual([]);
  });

  it("passes with the post confirmation open", async () => {
    await openFollowUps();
    await choose("Message Acme about the webhook change");
    await userEvent.click(
      screen.getByRole("button", { name: "Post to GitHub…" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    expect(await violations(dialog)).toEqual([]);
    expect(
      within(dialog).getByRole("button", { name: "Cancel" }),
    ).toBeDefined();
  });

  it("passes with nothing, and with a failed read", async () => {
    const empty = await openFollowUps({ rows: [] });
    expect(await violations(empty.view.container)).toEqual([]);
    cleanup();
    const failed = await openFollowUps({ failList: "The server broke." });
    expect(await violations(failed.view.container)).toEqual([]);
  });
});

describe("the rail's button", () => {
  it("is named with the due count", async () => {
    const opened = await openFollowUps();
    const workspace = createWorkspace({ storage: localStorage, wide: true });
    await workspace.view.setValue({
      ...workspace.view.getValue(),
      minimized: ["followups"],
    });
    await opened.state.followUpsDue.setValue({ count: 3, items: [] });
    renderPanel(opened.state, <Rail workspace={workspace} />, workspace);
    expect(
      screen.getByRole("button", { name: "Restore Follow-ups, 3 due" }),
    ).toBeDefined();
  });
});
