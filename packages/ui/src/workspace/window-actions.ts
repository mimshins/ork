/**
 * @file What can be done to the panel or group in hand: close, maximize, float,
 *   resize, move, and moving focus between groups. Each works on the dock
 *   through what the workspace hands it, and does nothing when no dock is
 *   mounted.
 */

import type {
  DockviewApi,
  DockviewGroupPanel,
  IDockviewPanel,
} from "dockview-react";

import {
  cycleFocus,
  movePanel,
  resizeGroup,
  sizeWords,
  toggleFloat as floatOrDock,
  toggleMaximized,
} from "./dock-moves.ts";
import type { Anchor } from "./layout.ts";
import type { PanelId } from "./panels.tsx";
import type { Direction } from "./shortcuts.ts";

export type WindowContext = {
  dock: () => DockviewApi | null;
  targetPanel: (id?: PanelId) => IDockviewPanel | undefined;
  commit: () => void;
  refocus: () => void;
  announce: (message: string) => void;
  /** Changes the dock without its own words, for saying something better. */
  quietly: (change: () => void) => void;
};

export const createWindowActions = ({
  dock,
  targetPanel,
  commit,
  refocus,
  announce,
  quietly,
}: WindowContext) => {
  const floatOrigins = new Map<string, NonNullable<Anchor["beside"]>>();

  const unmaximize = (): void => {
    const api = dock();
    if (api?.hasMaximizedGroup() === true) api.exitMaximizedGroup();
  };

  const close = (id?: PanelId): void => {
    const panel = targetPanel(id);
    if (panel === undefined) return;
    unmaximize();
    panel.api.close();
    commit();
    refocus();
  };

  const toggleMaximize = (group?: DockviewGroupPanel): void => {
    const target = group ?? dock()?.activeGroup;
    if (target !== undefined) toggleMaximized(target);
    commit();
  };

  const toggleFloat = (group?: DockviewGroupPanel): void => {
    const api = dock();
    const target = group ?? api?.activeGroup;
    if (api === null || target === undefined) return;
    unmaximize();
    floatOrDock(api, target, floatOrigins);
    commit();
    refocus();
  };

  const resize = (direction: Direction): void => {
    const api = dock();
    const group = api?.activeGroup;
    const panel = api?.activePanel;
    if (group === undefined || panel === undefined) return;
    if (api?.hasMaximizedGroup() === true) return;
    resizeGroup(group, direction);
    announce(sizeWords(panel));
  };

  const move = (direction: Direction): void => {
    const api = dock();
    const panel = api?.activePanel;
    if (api === null || panel === undefined) return;
    quietly(() => {
      unmaximize();
      movePanel(api, panel, direction);
    });
    commit();
    refocus();
    announce(`${panel.title ?? panel.id} moved ${direction}.`);
  };

  const cycleGroup = (step: 1 | -1): void => {
    const api = dock();
    if (api !== null) cycleFocus(api, step);
  };

  return { close, toggleMaximize, toggleFloat, resize, move, cycleGroup };
};
