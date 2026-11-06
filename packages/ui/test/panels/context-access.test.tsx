/**
 * @file Tests for the Context panel's access: it passes axe, a row's name is
 *   what it shows, a failed update is said through the live region, and the
 *   focus moves only inside the panel: to a new node's heading, or to what it
 *   says when no node is left, never from another panel.
 */

import type { NodeContextAnswer } from "@krapht/ork-server/client";
import { act, cleanup, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createWorkspace } from "../../src/workspace/workspace.ts";
import { violations } from "../axe.ts";
import { stubWindow } from "../dom.ts";
import { planned } from "./context-fixtures.ts";
import { chooseRunNode, open, row, rowNamed } from "./context-harness.tsx";

beforeEach(() => {
  stubWindow();
});

afterEach(() => {
  cleanup();
});

/** Answers every ask, or refuses it while `server.refuse` is set. */
const refusingWhen =
  (server: { refuse: boolean }, refusal: string) =>
  (): NodeContextAnswer | string =>
    server.refuse ? refusal : planned();

describe("the Context panel's access", () => {
  it("passes axe with a piece open", async () => {
    const opened = open();
    await chooseRunNode(opened, "fix");
    await userEvent.click(await row(/^ork:review/u));
    expect(await violations(opened.view.container)).toEqual([]);
  });

  it("names a row by what it shows, with no label over it", async () => {
    await chooseRunNode(open(), "fix");
    await rowNamed(
      "ork:review, live, workflow layer, .ork/workflows/skills/review, about 1,204 tokens",
    );
    expect(document.querySelectorAll("[data-piece]").length).toBeGreaterThan(5);
    expect(document.querySelectorAll("[data-piece][aria-label]")).toHaveLength(
      0,
    );
  });

  it("says a failed update through the live region", async () => {
    const workspace = createWorkspace({ storage: localStorage, wide: true });
    const server = { refuse: false };
    const opened = open(refusingWhen(server, "No run `aaa11111`."), workspace);
    await chooseRunNode(opened, "fix");
    await row(/^ork:review/u);
    server.refuse = true;
    await userEvent.click(screen.getByRole("button", { name: "Reload" }));
    await vi.waitFor(() => {
      expect(workspace.announcement.getValue()).toBe(
        "Couldn't update: No run aaa11111. This is the answer from before.",
      );
    });
  });

  it("takes the focus to the new node's heading when it had the focus", async () => {
    const opened = open();
    await chooseRunNode(opened, "fix");
    (await row(/^ork:review/u)).focus();
    await act(async () => {
      opened.state.selectNode("lead");
      await Promise.resolve();
    });
    await row(/^ork:review/u);
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { level: 2, name: "lead" }),
    );
  });

  it("keeps the focus in the panel when its node goes", async () => {
    const opened = open();
    await chooseRunNode(opened, "fix");
    (await row(/^ork:review/u)).focus();
    await chooseRunNode(opened, null);
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.textContent).toContain(
      "No node chosen in this run.",
    );
  });

  it("never takes the focus from another panel", async () => {
    const opened = open();
    const elsewhere = document.createElement("button");
    document.body.append(elsewhere);
    elsewhere.focus();
    await chooseRunNode(opened, "fix");
    await row(/^ork:review/u);
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });
});
