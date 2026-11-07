/**
 * @file Open run, for a panel that links to one (Feedback, Worktrees): shows
 *   the run in the Monitor, its heading taking the focus. The dock focuses the
 *   Monitor's tab on its next frame, so the heading is focused after that, if
 *   it's drawn, and the wait for it ends there; a run not shown yet takes the
 *   focus when its header first draws.
 */

import type { AppState } from "../state/app-state.ts";
import type { Workspace } from "../workspace/context.ts";

export const openRunIn = (
  state: AppState,
  workspace: Workspace | null,
  run: string,
  node?: string,
): void => {
  state.arriveAt(run);
  if (node !== undefined) state.selectNode(node);
  workspace?.goTo("monitor");
  requestAnimationFrame(() => {
    const heading = document.querySelector<HTMLElement>(
      `[data-run-heading="${run}"]`,
    );
    if (heading === null) return;
    state.takeArrival(run);
    heading.focus();
  });
};
