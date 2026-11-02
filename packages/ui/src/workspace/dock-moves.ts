/**
 * @file What the keyboard does to the dock: moving focus between groups,
 *   resizing, moving and floating. dockview's mouse covers all of it, but its
 *   free build has no keys for these and its sashes take no focus
 *   (specs/ui/workspace.md). Nothing here knows about React or the saved
 *   layout.
 */

import type {
  DockviewApi,
  DockviewGroupPanel,
  IDockviewPanel,
} from "dockview-react";

import { anchorOf, floatBoxOf } from "./dock-ops.ts";
import type { Anchor } from "./layout.ts";
import type { Direction } from "./shortcuts.ts";

/** How far one key press resizes or moves, in pixels. */
export const STEP = 32;

export const groupById = (
  api: DockviewApi,
  id: string,
): DockviewGroupPanel | undefined => api.groups.find(group => group.id === id);

/** Puts keyboard focus on the group's selected tab. */
export const focusTabOf = (group: DockviewGroupPanel): boolean => {
  const tab = group.element.querySelector<HTMLElement>(
    '[role="tab"][aria-selected="true"]',
  );
  tab?.focus();
  return tab !== null;
};

/** Selects a panel and, once dockview has drawn it, focuses its tab. */
export const focusPanel = (panel: IDockviewPanel): void => {
  panel.api.setActive();
  requestAnimationFrame(() => {
    focusTabOf(panel.group);
  });
};

/** The groups in reading order: by column, then top to bottom. */
const inReadingOrder = (groups: readonly DockviewGroupPanel[]) =>
  groups
    .map(group => ({ group, box: group.element.getBoundingClientRect() }))
    .toSorted((a, b) => a.box.left - b.box.left || a.box.top - b.box.top)
    .map(({ group }) => group);

/** Moves focus to the next group, or the previous one, in reading order. */
export const cycleFocus = (api: DockviewApi, step: 1 | -1): void => {
  const groups = inReadingOrder(api.groups);
  const { activeGroup } = api;
  if (groups.length === 0) return;
  const current = activeGroup === undefined ? 0 : groups.indexOf(activeGroup);
  const next = groups[(current + step + groups.length) % groups.length];
  if (next === undefined) return;
  next.activePanel?.api.setActive();
  focusTabOf(next);
};

/** Maximizes a docked group or restores it. A floating group has neither. */
export const toggleMaximized = (group: DockviewGroupPanel): void => {
  if (group.api.location.type !== "grid") return;
  if (group.api.isMaximized()) group.api.exitMaximized();
  else group.api.maximize();
  focusTabOf(group);
};

const SIZE_CHANGE: Record<
  Direction,
  { axis: "width" | "height"; delta: number }
> = {
  right: { axis: "width", delta: STEP },
  left: { axis: "width", delta: -STEP },
  down: { axis: "height", delta: STEP },
  up: { axis: "height", delta: -STEP },
};

/** Makes a group wider (→), narrower (←), taller (↓) or shorter (↑). */
export const resizeGroup = (
  group: DockviewGroupPanel,
  direction: Direction,
): void => {
  const { axis, delta } = SIZE_CHANGE[direction];
  group.api.setSize({ [axis]: group.api[axis] + delta });
};

/** A panel's size, as the live region says it. */
export const sizeWords = (panel: IDockviewPanel): string => {
  const width = String(Math.round(panel.group.api.width));
  const height = String(Math.round(panel.group.api.height));
  return `${panel.title ?? panel.id}: ${width} by ${height}.`;
};

const OFFSETS: Record<Direction, { x: number; y: number }> = {
  right: { x: STEP, y: 0 },
  left: { x: -STEP, y: 0 },
  down: { x: 0, y: STEP },
  up: { x: 0, y: -STEP },
};

const EDGES: Record<Direction, "left" | "right" | "above" | "below"> = {
  left: "left",
  right: "right",
  up: "above",
  down: "below",
};

/**
 * Moves a panel one step: a floating group shifts on the screen; a docked panel
 * joins the neighboring group as a tab, or takes that edge of the workspace
 * when there is no neighbor.
 */
export const movePanel = (
  api: DockviewApi,
  panel: IDockviewPanel,
  direction: Direction,
): void => {
  const { group } = panel;
  const box = floatBoxOf(api, group);
  if (box !== undefined) {
    const { x, y } = OFFSETS[direction];
    api.addFloatingGroup(group, {
      x: Math.max(0, box.left + x),
      y: Math.max(0, box.top + y),
      width: box.width,
      height: box.height,
    });
    return;
  }
  const neighbor = api.adjacentGroupInDirection(group, direction);
  const target =
    neighbor === undefined ? undefined : groupById(api, neighbor.id);
  if (target !== undefined) {
    panel.api.moveTo({ group: target, position: "center" });
    return;
  }
  if (group.panels.length === 1 && api.groups.length === 1) return;
  panel.api.moveTo({
    group: api.addGroup({ direction: EDGES[direction] }),
    position: "center",
  });
};

const SIDES = {
  left: "left",
  right: "right",
  above: "top",
  below: "bottom",
} as const;

/**
 * Floats a docked group, or docks a floating one where it left: beside the same
 * neighbor, or on that side of the workspace when the neighbor is gone. A group
 * whose origin is unknown docks at the right. `origins` lasts the page's life.
 */
export const toggleFloat = (
  api: DockviewApi,
  group: DockviewGroupPanel,
  origins: Map<string, NonNullable<Anchor["beside"]>>,
): void => {
  const panel = group.activePanel;
  if (panel === undefined) return;
  if (group.api.location.type !== "floating") {
    const { beside } = anchorOf(api, panel);
    api.addFloatingGroup(group);
    const floated = api.getPanel(panel.id)?.group;
    if (floated !== undefined && beside !== undefined) {
      origins.set(floated.id, beside);
    }
    return;
  }
  const origin = origins.get(group.id);
  origins.delete(group.id);
  const neighbor =
    origin?.group === undefined || origin.group === null
      ? undefined
      : groupById(api, origin.group);
  const direction = origin?.direction ?? "right";
  group.api.moveTo(
    neighbor === undefined
      ? { position: SIDES[direction] }
      : { group: neighbor, position: SIDES[direction] },
  );
  if (origin === undefined) return;
  group.api.setSize(
    direction === "left" || direction === "right"
      ? { width: origin.width }
      : { height: origin.height },
  );
};
