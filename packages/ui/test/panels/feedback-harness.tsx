/**
 * @file The Feedback panel's tests' harness: the panel on a fake server that
 *   answers the feedback routes, in a workspace whose Go to and announcements a
 *   test can read, with anything else to draw beside it, and the ways to choose
 *   an item and press its buttons.
 */

import { act, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { expect, vi } from "vitest";

import { FeedbackPanel } from "../../src/panels/feedback-panel.tsx";
import { runActions } from "../../src/panels/monitor-model.ts";
import { RunControls } from "../../src/panels/run-controls.tsx";
import { createWorkspace } from "../../src/workspace/workspace.ts";
import { runView } from "../state/fixtures.ts";
import {
  type FeedbackServer,
  feedbackRoute,
  ITEMS,
} from "./feedback-fixtures.ts";
import { openPanelState, renderPanel } from "./harness.tsx";

export const openFeedback = async (
  server: Partial<FeedbackServer> = {},
  /** Drawn beside the panel, such as the Monitor's header. */
  beside: Parameters<typeof renderPanel>[1] = null,
) => {
  const fake: FeedbackServer = { items: ITEMS, asked: [], ...server };
  const opened = openPanelState({ builder: feedbackRoute(fake) });
  const workspace = createWorkspace({ storage: localStorage, wide: true });
  const goTo = vi.spyOn(workspace, "goTo").mockImplementation(() => {});
  const view = renderPanel(
    opened.state,
    <>
      <FeedbackPanel />
      {beside}
    </>,
    workspace,
  );
  await vi.waitFor(() => {
    expect(screen.queryByText("Reading feedback…")).toBeNull();
  });
  return { ...opened, server: fake, workspace, goTo, view };
};

export type OpenedFeedback = Awaited<ReturnType<typeof openFeedback>>;

/** A row, by the start of its name: the item's title. */
export const rowOf = (title: string): HTMLElement =>
  screen.getByRole("button", { name: new RegExp(`^${escaped(title)},`, "u") });

const escaped = (text: string): string =>
  text.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);

/** Chooses an item and waits for its records. */
export const choose = async (title: string): Promise<void> => {
  await userEvent.click(rowOf(title));
  await screen.findByRole("list", { name: /^Records of/u });
};

/** The chosen item's actions. */
export const actions = () =>
  within(screen.getByRole("group", { name: /^Actions on/u }));

/** The named route's calls, with what each sent. */
export const asked = (opened: OpenedFeedback, route: string) =>
  opened.server.asked.filter(call => call.route === route);

export const announced = (opened: OpenedFeedback): string =>
  opened.workspace.announcement.getValue();

/** Picks an option of a select. */
export const pick = async (label: string, option: string): Promise<void> => {
  await userEvent.click(screen.getByRole("combobox", { name: label }));
  await userEvent.click(await screen.findByRole("option", { name: option }));
};

/** Lets the answers in flight land. */
export const settle = async (): Promise<void> => {
  await act(async () => {
    await new Promise(resolve => {
      setTimeout(resolve, 0);
    });
  });
};

const RUN = runView("aaa11111");

const CAN_NOTE = { enabled: true } as const;

/** A run's controls, or a node's, on the same fake server. */
export const openNote = (
  node?: string,
  refuse: FeedbackServer["refuse"] = {},
  note: { enabled: true } | { enabled: false; why: string } = CAN_NOTE,
) => {
  const server: FeedbackServer = { items: ITEMS, asked: [], refuse };
  const opened = openPanelState({ builder: feedbackRoute(server) });
  const view = renderPanel(
    opened.state,
    <RunControls
      actions={runActions(RUN)}
      node={node}
      note={note}
      runId={RUN.id}
    />,
  );
  return { ...opened, server, view };
};

/** A panel this many pixels wide, as a ResizeObserver reports it. */
export const stubWidth = (width: number): void => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      callback: (entries: { contentRect: { width: number } }[]) => void;
      constructor(
        callback: (entries: { contentRect: { width: number } }[]) => void,
      ) {
        this.callback = callback;
      }
      observe = (): void => {
        queueMicrotask(() => {
          this.callback([{ contentRect: { width } }]);
        });
      };
      unobserve = (): void => {};
      disconnect = (): void => {};
    },
  );
};

/** The words an element's `aria-describedby` points at, joined. */
export const describedBy = (element: HTMLElement): string =>
  (element.getAttribute("aria-describedby") ?? "")
    .split(/\s+/u)
    .filter(id => id !== "")
    .map(id => document.querySelector(`[id="${id}"]`)?.textContent ?? "")
    .join(" ")
    .trim();
