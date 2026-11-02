/**
 * @file Everything the workspace can do, as a list of commands: the palette and
 *   the keyboard read it, so a key and a palette entry can never disagree. A
 *   command that does not apply now stays listed and says why.
 */

import { PANELS, panelOf } from "./panels.tsx";
import { type Direction, type Shortcut, SHORTCUTS } from "./shortcuts.ts";
import type { WorkspaceView } from "./workspace-view.ts";
import type { Workspace } from "./workspace.ts";

export type CommandGroup = "Panels" | "Window" | "Layout";

export type Command = {
  id: string;
  title: string;
  group: CommandGroup;
  run: () => void;
  shortcut?: Shortcut;
  /** Why it cannot run now; absent when it can. */
  disabled?: string | undefined;
};

const NEEDS_DOCK = "Needs a window at least 1024 px wide.";
const NEEDS_PANEL = "No panel is active.";

const DIRECTIONS: readonly Direction[] = ["left", "right", "up", "down"];

const RESIZE_WORD: Record<Direction, string> = {
  left: "narrower",
  right: "wider",
  up: "shorter",
  down: "taller",
};

/** Why a command on the active panel cannot run, if it cannot. */
const blockedFor = (view: WorkspaceView): string | undefined => {
  if (!view.wide) return NEEDS_DOCK;
  return view.active === null ? NEEDS_PANEL : undefined;
};

const panelCommands = (workspace: Workspace): Command[] =>
  PANELS.map((panel, index) => ({
    id: `go-${panel.id}`,
    title: `Go to ${panel.title}`,
    group: "Panels",
    shortcut: SHORTCUTS.goTo(index + 1),
    run: () => {
      workspace.goTo(panel.id);
    },
  }));

const windowCommands = (
  workspace: Workspace,
  view: WorkspaceView,
): Command[] => {
  const blocked = blockedFor(view);
  const name = view.active === null ? "panel" : panelOf(view.active).title;
  const maximizeBlocked =
    blocked ??
    (view.floating ? "A floating panel cannot be maximized." : undefined);
  const resizeBlocked =
    blocked ?? (view.maximized ? "Restore the panel first." : undefined);
  return [
    {
      id: "minimize",
      title: `Minimize ${name}`,
      group: "Window",
      shortcut: SHORTCUTS.minimize,
      run: () => {
        workspace.minimize();
      },
      disabled: blocked,
    },
    {
      id: "maximize",
      title: view.maximized ? `Restore ${name}` : `Maximize ${name}`,
      group: "Window",
      shortcut: SHORTCUTS.maximize,
      run: () => {
        workspace.toggleMaximize();
      },
      disabled: maximizeBlocked,
    },
    {
      id: "float",
      title: view.floating ? `Dock ${name}` : `Float ${name}`,
      group: "Window",
      shortcut: SHORTCUTS.float,
      run: () => {
        workspace.toggleFloat();
      },
      disabled: blocked,
    },
    {
      id: "close",
      title: `Close ${name}`,
      group: "Window",
      shortcut: SHORTCUTS.close,
      run: () => {
        workspace.close();
      },
      disabled: blocked,
    },
    ...DIRECTIONS.map((direction): Command => ({
      id: `resize-${direction}`,
      title: `Make ${name} ${RESIZE_WORD[direction]}`,
      group: "Window",
      shortcut: SHORTCUTS.resize(direction),
      run: () => {
        workspace.resize(direction);
      },
      disabled: resizeBlocked,
    })),
    ...DIRECTIONS.map((direction): Command => ({
      id: `move-${direction}`,
      title: `Move ${name} ${direction}`,
      group: "Window",
      shortcut: SHORTCUTS.move(direction),
      run: () => {
        workspace.move(direction);
      },
      disabled: blocked,
    })),
  ];
};

const layoutCommands = (
  workspace: Workspace,
  view: WorkspaceView,
): Command[] => {
  const blocked = view.wide ? undefined : NEEDS_DOCK;
  return [
    {
      id: "next-group",
      title: "Focus next panel group",
      group: "Layout",
      shortcut: SHORTCUTS.nextGroup,
      run: () => {
        workspace.cycleGroup(1);
      },
      disabled: blocked,
    },
    {
      id: "previous-group",
      title: "Focus previous panel group",
      group: "Layout",
      shortcut: SHORTCUTS.previousGroup,
      run: () => {
        workspace.cycleGroup(-1);
      },
      disabled: blocked,
    },
    {
      id: "reset-layout",
      title: "Reset layout",
      group: "Layout",
      run: () => {
        workspace.resetLayout();
      },
    },
  ];
};

export const commandsFor = (
  workspace: Workspace,
  view: WorkspaceView,
): Command[] => [
  ...panelCommands(workspace),
  ...windowCommands(workspace, view),
  ...layoutCommands(workspace, view),
];
