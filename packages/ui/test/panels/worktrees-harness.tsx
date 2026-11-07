/**
 * @file The Worktrees panel's tests' harness: the panel on a fake server that
 *   answers the worktrees routes, in a workspace whose Go to and announcements
 *   a test can read, and the ways to reach a row's buttons and the open
 *   dialog.
 */

import { act, screen, within } from "@testing-library/react";
import { expect, vi } from "vitest";

import { WorktreesPanel } from "../../src/panels/worktrees-panel.tsx";
import { createWorkspace } from "../../src/workspace/workspace.ts";
import { openPanelState, renderPanel } from "./harness.tsx";
import {
  CLEAN,
  plan,
  PROJECTS,
  type WorktreesServer,
  worktreesRoute,
} from "./worktrees-fixtures.ts";

export const openWorktrees = async (server: Partial<WorktreesServer> = {}) => {
  const fake: WorktreesServer = {
    projects: PROJECTS,
    plans: () => plan("ork/4f2a1c/build: remove worktree"),
    clean: CLEAN,
    asked: [],
    ...server,
  };
  const opened = openPanelState({ builder: worktreesRoute(fake) });
  const workspace = createWorkspace({ storage: localStorage, wide: true });
  const goTo = vi.spyOn(workspace, "goTo").mockImplementation(() => {});
  const view = renderPanel(opened.state, <WorktreesPanel />, workspace);
  await vi.waitFor(() => {
    expect(screen.queryByText("Reading worktrees…")).toBeNull();
  });
  return { ...opened, server: fake, workspace, goTo, view };
};

export type OpenedWorktrees = Awaited<ReturnType<typeof openWorktrees>>;

/** A row of the list, by its name. */
export const rowOf = (label: string): HTMLElement => {
  const found = document.querySelector<HTMLElement>(
    `[data-worktree-row="${label}"]`,
  );
  if (found === null) throw new Error(`No row ${label}.`);
  return found;
};

export const removeOf = (label: string): HTMLElement =>
  within(rowOf(label)).getByRole("button", {
    name: /^(?:Remove|Delete branch) /u,
  });

export const dialog = () => within(screen.getByRole("dialog"));

/** The named route's calls, with what each sent. */
export const asked = (opened: OpenedWorktrees, route: string) =>
  opened.server.asked.filter(call => call.route === route);

export const announced = (opened: OpenedWorktrees): string =>
  opened.workspace.announcement.getValue();

/** Lets the answers in flight land. */
export const settle = async (): Promise<void> => {
  await act(async () => {
    await new Promise(resolve => {
      setTimeout(resolve, 0);
    });
  });
};
