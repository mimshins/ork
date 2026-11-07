/**
 * @file The dock's layout: the default one, each group's smallest size, where a
 *   panel is and how to put it back. Nothing here knows about React or the
 *   saved layout.
 */

import {
  type AddPanelOptions,
  type DockviewApi,
  type DockviewGroupPanel,
  type IDockviewPanel,
  Orientation,
  type SerializedDockview,
} from "dockview-react";

import type { Anchor, FloatBox } from "./layout.ts";
import { type PanelId, panelOf } from "./panels.tsx";

const SIDE_WIDTH = 280;
const DECISIONS_WIDTH = 340;
const BOTTOM_HEIGHT = 240;

/** The smallest a group gets: room for its tabs, its buttons and some content. */
const GROUP_MINIMUM = { minimumWidth: 240, minimumHeight: 120 };

export const constrainGroup = (group: DockviewGroupPanel): void => {
  group.api.setConstraints(GROUP_MINIMUM);
};

/**
 * Calls back on anything that changes what the dock shows, or how it is laid
 * out.
 */
export const listenToDock = (
  api: DockviewApi,
  onShown: () => void,
  onLaidOut: () => void,
): { dispose: () => void }[] => [
  api.onDidAddGroup(constrainGroup),
  api.onDidLayoutChange(() => {
    onLaidOut();
    onShown();
  }),
  api.onDidAddPanel(onShown),
  api.onDidRemovePanel(onShown),
  api.onDidActivePanelChange(onShown),
  api.onDidMaximizedGroupChange(onShown),
];

/** Fills the dock from a saved layout; false, and empty, if it cannot. */
export const restoreDock = (
  api: DockviewApi,
  dock: SerializedDockview,
): boolean => {
  try {
    api.fromJSON(dock);
    return true;
  } catch {
    api.clear();
    return false;
  }
};

const add = (
  api: DockviewApi,
  id: PanelId,
  placement: Partial<AddPanelOptions>,
): IDockviewPanel =>
  api.addPanel({
    id,
    component: id,
    title: panelOf(id).title,
    ...placement,
  });

/**
 * Runs on the left, Monitor over Logs, Chats, Usage, Feedback and Worktrees,
 * and Decisions and Notifications over Context on the right.
 */
export const addDefaultLayout = (api: DockviewApi): void => {
  const monitor = add(api, "monitor", {});
  add(api, "builder", {
    position: { referencePanel: "monitor", direction: "within" },
    inactive: true,
  });
  add(api, "runs", {
    position: { referencePanel: "monitor", direction: "left" },
    initialWidth: SIDE_WIDTH,
    inactive: true,
  });
  add(api, "decisions", {
    position: { referencePanel: "monitor", direction: "right" },
    initialWidth: DECISIONS_WIDTH,
    inactive: true,
  });
  add(api, "notifications", {
    position: { referencePanel: "decisions", direction: "within" },
    inactive: true,
  });
  // Its own group under Decisions: read beside the Monitor or the Builder,
  // and never hiding a decision that waits on the person.
  add(api, "context", {
    position: { referencePanel: "decisions", direction: "below" },
  });
  add(api, "logs", {
    position: { referencePanel: "monitor", direction: "below" },
    initialHeight: BOTTOM_HEIGHT,
    inactive: true,
  });
  add(api, "chats", {
    position: { referencePanel: "logs", direction: "within" },
    inactive: true,
  });
  add(api, "usage", {
    position: { referencePanel: "logs", direction: "within" },
    inactive: true,
  });
  // Wide enough for its list beside an item, and never hiding a decision.
  add(api, "feedback", {
    position: { referencePanel: "usage", direction: "within" },
    inactive: true,
  });
  // Wide enough for a path on one line, and never hiding a decision.
  add(api, "worktrees", {
    position: { referencePanel: "feedback", direction: "within" },
    inactive: true,
  });
  monitor.api.setActive();
};

type GridNode = SerializedDockview["grid"]["root"];

type Place = { siblings: readonly GridNode[]; index: number; along: boolean };

/** Where a group sits in its split; `along` means the split runs the root's way. */
const placeIn = (
  node: GridNode,
  id: string,
  along: boolean,
): Place | undefined => {
  if (!Array.isArray(node.data)) return undefined;
  const siblings = node.data;
  const index = siblings.findIndex(
    child => !Array.isArray(child.data) && child.data.id === id,
  );
  if (index !== -1) return { siblings, index, along };
  for (const child of siblings) {
    const found = placeIn(child, id, !along);
    if (found !== undefined) return found;
  }
  return undefined;
};

const BEFORE = { horizontal: "left", vertical: "above" } as const;
const AFTER = { horizontal: "right", vertical: "below" } as const;

/**
 * What a docked group's place is relative to the split it sits in, so it can
 * come back there: beside the next group or the one before; or, when that is a
 * whole column or row of the workspace, at the workspace's edge.
 */
const besideOf = (
  api: DockviewApi,
  group: DockviewGroupPanel,
): Anchor["beside"] => {
  const { root, orientation } = api.toJSON().grid;
  const rootHorizontal = orientation === Orientation.HORIZONTAL;
  const place = placeIn(root, group.id, true);
  if (place === undefined) return undefined;
  const { siblings, index, along } = place;
  const axis = along === rootHorizontal ? "horizontal" : "vertical";
  const next = siblings[index + 1];
  const sibling = next ?? siblings[index - 1];
  if (sibling === undefined) return undefined;
  const size = { width: group.api.width, height: group.api.height };
  const direction = next === undefined ? AFTER[axis] : BEFORE[axis];
  if (Array.isArray(sibling.data)) {
    return along ? { group: null, direction, ...size } : undefined;
  }
  return { group: sibling.data.id, direction, ...size };
};

/**
 * A floating group's window, measured from the dock's top left. dockview's
 * serialized layout is the exact one to read: `boundingBox` leaves out the
 * floating titlebar, so a window placed from it would shrink each time.
 */
export const floatBoxOf = (
  api: DockviewApi,
  group: DockviewGroupPanel,
): FloatBox | undefined => {
  if (group.api.location.type !== "floating") return undefined;
  const floating = api
    .toJSON()
    .floatingGroups?.find(entry => entry.data?.id === group.id);
  if (floating === undefined) return undefined;
  const { position } = floating;
  const { width, height } = position;
  return {
    left:
      "left" in position ? position.left : api.width - position.right - width,
    top:
      "top" in position ? position.top : api.height - position.bottom - height,
    width,
    height,
  };
};

/** Where a panel is now, for `placeAt` to put it back. */
export const anchorOf = (api: DockviewApi, panel: IDockviewPanel): Anchor => {
  const { group } = panel;
  const box = floatBoxOf(api, group);
  const beside = besideOf(api, group);
  return {
    group: group.id,
    index: group.panels.indexOf(panel),
    ...(box === undefined ? {} : { floating: box }),
    ...(beside === undefined ? {} : { beside }),
  };
};

const placementOf = (
  api: DockviewApi,
  anchor: Anchor | undefined,
): Partial<AddPanelOptions> => {
  if (anchor !== undefined) {
    if (api.getGroup(anchor.group) !== undefined) {
      return {
        position: {
          referenceGroup: anchor.group,
          direction: "within",
          index: anchor.index,
        },
      };
    }
    if (anchor.floating !== undefined) {
      const { left, top, width, height } = anchor.floating;
      return { floating: { x: left, y: top, width, height } };
    }
    if (anchor.beside !== undefined) {
      const { group, direction, width, height } = anchor.beside;
      // Only along its split: the other way, it shares its neighbor's size.
      const size =
        direction === "left" || direction === "right"
          ? { initialWidth: width }
          : { initialHeight: height };
      if (group === null) return { position: { direction }, ...size };
      if (api.getGroup(group) !== undefined) {
        return { position: { referenceGroup: group, direction }, ...size };
      }
    }
  }
  const active = api.activeGroup;
  return active === undefined
    ? {}
    : { position: { referenceGroup: active.id, direction: "within" } };
};

/** Adds a panel where it was, or as a tab in the active group. */
export const placeAt = (
  api: DockviewApi,
  id: PanelId,
  anchor?: Anchor,
): IDockviewPanel => add(api, id, placementOf(api, anchor));
