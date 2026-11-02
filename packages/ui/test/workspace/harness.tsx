/**
 * @file The workspace tests' setup: a real workspace on the real dock, in
 *   jsdom, and how to read what it shows. jsdom has no layout, so sizes and
 *   drawn positions are checked in a browser instead (gap C6).
 */

import { createClient } from "@krapht/ork-server/client";
import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { TipProvider } from "../../src/components/tip.tsx";
import { Toasts } from "../../src/components/toast.tsx";
import { createAppState } from "../../src/state/app-state.ts";
import { AppStateProvider } from "../../src/state/context.tsx";
import { Shell } from "../../src/workspace/shell.tsx";
import {
  createWorkspace,
  type Workspace,
  type WorkspaceOptions,
} from "../../src/workspace/workspace.ts";
import { openFakeSources } from "../fake-source.ts";

export const openWorkspace = (
  options: Partial<WorkspaceOptions> = {},
): Workspace =>
  createWorkspace({ storage: localStorage, wide: true, ...options });

const openState = () =>
  createAppState({
    client: createClient({
      fetch: () => Promise.reject(new Error("no server")),
    }),
    open: openFakeSources().open,
    storage: localStorage,
  });

export const renderShell = (workspace: Workspace) =>
  render(
    <AppStateProvider value={openState()}>
      <TipProvider>
        <Toasts>
          <Shell workspace={workspace} />
        </Toasts>
      </TipProvider>
    </AppStateProvider>,
  );

/** Opens a workspace on the storage and draws it. */
export const openShell = (options: Partial<WorkspaceOptions> = {}) => {
  const workspace = openWorkspace(options);
  return { workspace, ...renderShell(workspace) };
};

/** The tabs in the dock, by name. */
export const tabNames = (): string[] =>
  screen
    .queryAllByRole("tab")
    .map(tab => tab.getAttribute("aria-label") ?? "")
    .toSorted();

/** The panels on the rail, by the name of their button. */
export const railNames = (): string[] => {
  const rail = screen.queryByRole("navigation", { name: "Minimized panels" });
  return rail === null
    ? []
    : within(rail)
        .getAllByRole("button")
        .map(button => button.getAttribute("aria-label") ?? "");
};

export const keys = () => userEvent.setup();
