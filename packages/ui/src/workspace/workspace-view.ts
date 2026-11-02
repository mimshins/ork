/**
 * @file What the workspace shows now, as a value: which panels are open, on the
 *   rail or folded, and what the active one is doing. Worked out from the dock
 *   and the saved layout, and read by the rail, the Window menu and the
 *   palette.
 */

import type { DockviewApi } from "dockview-react";

import type { SavedLayout } from "./layout.ts";
import { isPanelId, type PanelId, PANELS } from "./panels.tsx";

/** The narrowest window that gets a dock. */
export const WIDE_QUERY = "(min-width: 1024px)";

export type WorkspaceView = {
  /** Wide enough for the dock; otherwise the panels stack. */
  wide: boolean;
  /** The panels in the dock, in the panel list's order. */
  open: readonly PanelId[];
  minimized: readonly PanelId[];
  folded: readonly PanelId[];
  active: PanelId | null;
  floating: boolean;
  maximized: boolean;
};

export const viewOf = (
  api: DockviewApi | null,
  saved: SavedLayout,
  wide: boolean,
): WorkspaceView => {
  const panels = api?.panels ?? [];
  const activeId = api?.activePanel?.id;
  return {
    wide,
    open: PANELS.map(panel => panel.id).filter(id =>
      panels.some(panel => panel.id === id),
    ),
    minimized: saved.minimized.map(panel => panel.id),
    folded: saved.folded,
    active: activeId !== undefined && isPanelId(activeId) ? activeId : null,
    floating: api?.activePanel?.group.api.location.type === "floating",
    maximized: api?.hasMaximizedGroup() ?? false,
  };
};

export const sameView = (a: WorkspaceView, b: WorkspaceView): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

export const stackHeadingId = (id: PanelId): string => `stack-${id}`;
export const railButtonId = (id: PanelId): string => `rail-${id}`;

export const focusById = (id: string): void => {
  document.querySelector<HTMLElement>(`#${id}`)?.focus();
};
