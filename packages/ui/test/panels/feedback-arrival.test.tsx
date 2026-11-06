/**
 * @file Tests for where the focus goes when the Feedback panel shows a run in
 *   the Monitor (WCAG 2.4.3): a record's Open run, on a run the Monitor shows
 *   already or not, and Propose fix's new run each put the focus on the run's
 *   heading, after the dock has focused the Monitor's tab; and the wait for it
 *   ends there, so the header drawn again later (a change of layout) leaves the
 *   focus where the person put it.
 */

import { act, cleanup, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { Container, useValue } from "react-containerized-state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RunHeader } from "../../src/panels/run-header.tsx";
import { useAppState } from "../../src/state/context.tsx";
import { stubWindow } from "../dom.ts";
import { runView } from "../state/fixtures.ts";
import { actions, choose, openFeedback, rowOf } from "./feedback-harness.tsx";

const LOOP_TITLE = "The loop reviews -> lead ran out of its 2 rounds";

/** Bumped to draw the header afresh, as a change of the dock's layout does. */
const layout = Container.create(0);

/** The Monitor's header for the selected run, as the Monitor draws it. */
const ShownRun = () => {
  const { run } = useValue(useAppState().selection);
  const drawn = useValue(layout);
  return run === null ? null : (
    <RunHeader
      budgetUsd={undefined}
      facts={new Map()}
      key={`${run}-${String(drawn)}`}
      now={0}
      run={runView(run)}
      waiting={false}
    />
  );
};

/** The dock and the Monitor beside the panel: its tab, then its header. */
const Monitor = () => (
  <>
    <button type="button">Monitor tab</button>
    <ShownRun />
  </>
);

/** Go to does as the dock does: it focuses the panel's tab on the next frame. */
const likeTheDock = (opened: Awaited<ReturnType<typeof openFeedback>>) => {
  opened.goTo.mockImplementation(() => {
    requestAnimationFrame(() => {
      screen.getByRole("button", { name: "Monitor tab" }).focus();
    });
  });
};

const heading = (run: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-run-heading="${run}"]`);

const redraw = async (): Promise<void> => {
  await act(async () => {
    await layout.setValue(layout.getValue() + 1);
  });
};

beforeEach(() => {
  localStorage.clear();
  stubWindow();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("showing a run from the Feedback panel", () => {
  it("focuses the heading of a run the Monitor shows already, once", async () => {
    const opened = await openFeedback({}, <Monitor />);
    likeTheDock(opened);
    act(() => {
      opened.state.selectRun("4f2a1c00");
    });
    await choose(LOOP_TITLE);
    await userEvent.click(
      screen.getByRole("button", {
        name: /^Open run\s*4f2a1c00 at reviews, /u,
      }),
    );
    expect(opened.goTo).toHaveBeenCalledWith("monitor");
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(heading("4f2a1c00"));
    });
    rowOf(LOOP_TITLE).focus();
    await redraw();
    expect(document.activeElement).toBe(rowOf(LOOP_TITLE));
  });

  it("focuses the heading of a run once the Monitor draws it", async () => {
    const opened = await openFeedback({}, <Monitor />);
    likeTheDock(opened);
    await choose(LOOP_TITLE);
    await userEvent.click(
      screen.getByRole("button", {
        name: /^Open run\s*4f2a1c00 at reviews, /u,
      }),
    );
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(heading("4f2a1c00"));
    });
    expect(opened.state.takeArrival("4f2a1c00")).toBe(false);
  });

  it("focuses a proposed fix's run, and not again when it's drawn again", async () => {
    likeTheDock(await openFeedback({}, <Monitor />));
    await choose(LOOP_TITLE);
    await userEvent.click(
      actions().getByRole("button", { name: "Propose fix…" }),
    );
    const confirm = await screen.findByRole("alertdialog");
    await userEvent.click(
      within(confirm).getByRole("button", { name: "Start run" }),
    );
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(heading("fix11111"));
    });
    rowOf(LOOP_TITLE).focus();
    await redraw();
    expect(document.activeElement).toBe(rowOf(LOOP_TITLE));
  });
});
