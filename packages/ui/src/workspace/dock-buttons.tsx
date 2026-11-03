/**
 * @file A panel group's header buttons: Minimize and Close act on its selected
 *   panel, Maximize and Float on the whole group. Each has an accessible name,
 *   and its keys in its tooltip and in `aria-keyshortcuts`.
 */

import type { IDockviewHeaderActionsProps } from "dockview-react";
import { type ReactNode, use } from "react";
import { useValue } from "react-containerized-state";

import { IconButton } from "../components/button.tsx";
import {
  IconClose,
  IconDock,
  IconFloat,
  IconMaximize,
  IconMinimize,
  IconRestore,
} from "../components/icons.tsx";
import { type Workspace, WorkspaceContext } from "./context.ts";
import { platformIsMac } from "./keys.ts";
import { isPanelId, type PanelId } from "./panels.tsx";
import { ariaKeysOf, keysOf, type Shortcut, SHORTCUTS } from "./shortcuts.ts";

import styles from "./dock.module.css";

const Action = ({
  label,
  shortcut,
  onClick,
  children,
}: {
  label: string;
  shortcut: Shortcut;
  onClick: () => void;
  children: ReactNode;
}) => {
  const mac = platformIsMac();
  return (
    <IconButton
      aria-keyshortcuts={ariaKeysOf(shortcut, mac)}
      keys={keysOf(shortcut, mac)}
      label={label}
      onClick={onClick}
    >
      {children}
    </IconButton>
  );
};

const Buttons = ({
  group,
  activePanel,
  workspace,
}: IDockviewHeaderActionsProps & { workspace: Workspace }) => {
  // The buttons' words follow the group's state, which `view` tracks.
  useValue(workspace.view);
  const title = activePanel?.title ?? "panel";
  const id: PanelId | undefined =
    activePanel !== undefined && isPanelId(activePanel.id)
      ? activePanel.id
      : undefined;
  const floating = group.api.location.type === "floating";
  const maximized = group.api.isMaximized();
  return (
    <div className={styles["buttons"]}>
      <Action
        label={`Minimize ${title}`}
        onClick={() => {
          workspace.minimize(id);
        }}
        shortcut={SHORTCUTS.minimize}
      >
        <IconMinimize />
      </Action>
      {floating ? null : (
        <Action
          label={maximized ? `Restore ${title}` : `Maximize ${title}`}
          onClick={() => {
            workspace.toggleMaximize(group);
          }}
          shortcut={SHORTCUTS.maximize}
        >
          {maximized ? <IconRestore /> : <IconMaximize />}
        </Action>
      )}
      <Action
        label={floating ? `Dock ${title}` : `Float ${title}`}
        onClick={() => {
          workspace.toggleFloat(group);
        }}
        shortcut={SHORTCUTS.float}
      >
        {floating ? <IconDock /> : <IconFloat />}
      </Action>
      <Action
        label={`Close ${title}`}
        onClick={() => {
          workspace.close(id);
        }}
        shortcut={SHORTCUTS.close}
      >
        <IconClose />
      </Action>
    </div>
  );
};

export const DockButtons = (props: IDockviewHeaderActionsProps) => {
  const workspace = use(WorkspaceContext);
  return workspace === null ? null : (
    <Buttons
      {...props}
      workspace={workspace}
    />
  );
};
