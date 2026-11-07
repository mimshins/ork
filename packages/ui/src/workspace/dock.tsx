/**
 * @file The dock: dockview with Ork's theme, tabs and panel buttons. A tab
 *   shows an icon and a title and holds no button of its own, since a control
 *   inside a tab is invalid; the group's header carries Minimize, Maximize,
 *   Float and Close, each with its name and keys, and each panel has a heading
 *   for screen readers. dockview's announcements go to the workspace's one live
 *   region.
 */

import {
  type DockviewReadyEvent,
  DockviewReact,
  type IDockviewPanelHeaderProps,
} from "dockview-react";

import "dockview-react/dist/styles/dockview.css";
import { useCallback, useEffect } from "react";

import { EmptyState } from "../components/bits.tsx";
import { DockButtons } from "./dock-buttons.tsx";
import { isPanelId, PANELS, panelOf } from "./panels.tsx";
import type { Workspace } from "./workspace.ts";

import styles from "./dock.module.css";

const GROUP_GAP = 6;

const Tab = ({ api }: IDockviewPanelHeaderProps) => {
  const Icon = isPanelId(api.id) ? panelOf(api.id).Icon : null;
  return (
    <span className={styles["tab"]}>
      {Icon === null ? null : <Icon />}
      {api.title}
    </span>
  );
};

const NoPanels = () => (
  <div className={styles["none"]}>
    <EmptyState title="No panels open.">
      Reopen one from Window, or press the command palette&apos;s keys.
    </EmptyState>
  </div>
);

/**
 * Each panel under a heading only a screen reader sees, as the stack's visible
 * one is, so the cards' `<h3>`s don't skip a level: the tab names the panel but
 * isn't a heading.
 */
const COMPONENTS = Object.fromEntries(
  PANELS.map(({ id, title, Body }) => [
    id,
    () => (
      <div className={styles["body"]}>
        <h2 className={styles["heading"]}>{title}</h2>
        <Body />
      </div>
    ),
  ]),
);

const THEME = {
  name: "ork",
  className: styles["dock"] ?? "",
  gap: GROUP_GAP,
  dndOverlayMounting: "relative",
  dndPanelOverlay: "group",
  dndTabIndicator: "line",
} as const;

export const Dock = ({ workspace }: { workspace: Workspace }) => {
  const onReady = useCallback(
    ({ api }: DockviewReadyEvent) => {
      workspace.attach(api);
    },
    [workspace],
  );
  useEffect(
    () => () => {
      workspace.detach();
    },
    [workspace],
  );
  return (
    <DockviewReact
      announcer={({ message }) => {
        workspace.announceFromDock(message);
      }}
      components={COMPONENTS}
      defaultTabComponent={Tab}
      disableTabsOverflowList
      onReady={onReady}
      rightHeaderActionsComponent={DockButtons}
      theme={THEME}
      watermarkComponent={NoPanels}
    />
  );
};
