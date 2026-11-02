/**
 * @file The workspace's state and actions. Containers hold `view`, what is open
 *   and active now; `layout`, what the browser remembers; `palette`, whether
 *   the palette is open; and `announcement`, the live region's text. The
 *   actions work on the dock while it is mounted, and on the narrow stack when
 *   the window is too small for one. The dock's own events are the truth for
 *   `view`.
 */

import type { DockviewApi, IDockviewPanel } from "dockview-react";
import { Container } from "react-containerized-state";

import { focusPanel, focusTabOf } from "./dock-moves.ts";
import {
  addDefaultLayout,
  anchorOf,
  constrainGroup,
  listenToDock,
  placeAt,
  restoreDock,
} from "./dock-ops.ts";
import {
  createLayoutStore,
  EMPTY_LAYOUT,
  type Minimized,
  readLayout,
  withFold,
} from "./layout.ts";
import { isPanelId, type PanelId, panelOf } from "./panels.tsx";
import { createWindowActions } from "./window-actions.ts";
import {
  focusById,
  railButtonId,
  sameView,
  stackHeadingId,
  viewOf,
  type WorkspaceView,
} from "./workspace-view.ts";

export type WorkspaceOptions = {
  storage: Storage;
  wide: boolean;
  /** Called when a saved layout could not be used and the default took over. */
  onLayoutDropped?: () => void;
};

export type Workspace = ReturnType<typeof createWorkspace>;

export const createWorkspace = ({
  storage,
  wide,
  onLayoutDropped,
}: WorkspaceOptions) => {
  const layout = createLayoutStore(storage);
  const known = readLayout(layout.getValue());
  let damaged = known === null;
  if (damaged) void layout.reset();

  const view = Container.create<WorkspaceView>(
    viewOf(null, known ?? EMPTY_LAYOUT, wide),
  );
  const palette = Container.create(false);
  const announcement = Container.create("");

  let api: DockviewApi | null = null;
  let filling = false;
  let listeners: { dispose: () => void }[] = [];

  const announce = (message: string): void => {
    void announcement.setValue(message);
  };

  /** What dockview says, except about the panels it adds while filling. */
  const announceFromDock = (message: string): void => {
    if (!filling) announce(message);
  };

  const sync = (): void => {
    const current = view.getValue();
    const next = viewOf(api, layout.getValue(), current.wide);
    if (!sameView(current, next)) void view.setValue(next);
  };

  const save = (): void => {
    if (api !== null) {
      void layout.setValue({ ...layout.getValue(), dock: api.toJSON() });
    }
  };

  /** After an action: dockview would save a moment later; a reload may not wait. */
  const commit = (): void => {
    save();
    sync();
  };

  const detach = (): void => {
    for (const listener of listeners) listener.dispose();
    listeners = [];
    api = null;
    sync();
  };

  const attach = (next: DockviewApi): void => {
    detach();
    filling = true;
    api = next;
    const { dock, folded } = layout.getValue();
    if (dock === null || !restoreDock(next, dock)) {
      damaged ||= dock !== null;
      void layout.setValue({ ...EMPTY_LAYOUT, folded });
      addDefaultLayout(next);
    }
    if (damaged) onLayoutDropped?.();
    damaged = false;
    next.groups.forEach(constrainGroup);
    listeners = listenToDock(next, sync, save);
    sync();
    filling = false;
  };

  const targetPanel = (id?: PanelId): IDockviewPanel | undefined =>
    id === undefined ? api?.activePanel : api?.getPanel(id);

  const unmaximize = (): void => {
    if (api?.hasMaximizedGroup() === true) api.exitMaximizedGroup();
  };

  const setMinimized = (
    change: (list: readonly Minimized[]) => readonly Minimized[],
  ): void => {
    const saved = layout.getValue();
    void layout.setValue({ ...saved, minimized: change(saved.minimized) });
  };

  /** Focus lands in the dock's next tab, or on the rail when none is left. */
  const refocus = (rail?: PanelId): void => {
    requestAnimationFrame(() => {
      const group = api?.activeGroup;
      const focused = group !== undefined && focusTabOf(group);
      if (!focused && rail !== undefined) focusById(railButtonId(rail));
    });
  };

  const minimize = (id?: PanelId): void => {
    const panel = targetPanel(id);
    if (api === null || panel === undefined) return;
    const panelId = panel.id;
    if (!isPanelId(panelId)) return;
    unmaximize();
    const anchor = anchorOf(api, panel);
    setMinimized(list => [...list, { id: panelId, anchor }]);
    panel.api.close();
    announce(`${panelOf(panelId).title} minimized.`);
    commit();
    refocus(panelId);
  };

  const restore = (id: PanelId): void => {
    if (api === null) return;
    const entry = layout.getValue().minimized.find(panel => panel.id === id);
    setMinimized(list => list.filter(panel => panel.id !== id));
    unmaximize();
    focusPanel(placeAt(api, id, entry?.anchor));
    announce(`${panelOf(id).title} restored.`);
    commit();
  };

  const setFold = (id: PanelId, fold: boolean): void => {
    const saved = layout.getValue();
    void layout.setValue({
      ...saved,
      folded: withFold(saved.folded, id, fold),
    });
    commit();
  };

  const toggleFold = (id: PanelId): void => {
    setFold(id, !layout.getValue().folded.includes(id));
  };

  /** Goes to a panel from anywhere: restores, reopens or unfolds it. */
  const goTo = (id: PanelId): void => {
    if (!view.getValue().wide) {
      setFold(id, false);
      focusById(stackHeadingId(id));
      return;
    }
    if (api === null) return;
    const panel = api.getPanel(id);
    if (panel !== undefined) {
      if (!panel.api.isMaximized()) unmaximize();
      focusPanel(panel);
    } else if (view.getValue().minimized.includes(id)) {
      restore(id);
    } else {
      unmaximize();
      focusPanel(placeAt(api, id));
      announce(`${panelOf(id).title} opened.`);
    }
  };

  const windowActions = createWindowActions({
    dock: () => api,
    targetPanel,
    commit,
    refocus,
    announce,
  });

  const resetLayout = (): void => {
    void layout.setValue(EMPTY_LAYOUT);
    if (api !== null) {
      filling = true;
      api.clear();
      addDefaultLayout(api);
      filling = false;
      api.groups.forEach(constrainGroup);
      save();
      refocus();
    }
    commit();
    announce("Layout reset.");
  };

  const setWide = (next: boolean): void => {
    const current = view.getValue();
    if (current.wide !== next) void view.setValue({ ...current, wide: next });
  };

  return {
    view,
    layout,
    palette,
    announcement,
    announce,
    announceFromDock,
    attach,
    detach,
    goTo,
    minimize,
    restore,
    toggleFold,
    resetLayout,
    ...windowActions,
    setWide,
  };
};
