/**
 * @file Everything the workspace can do, as a list of commands: the palette and
 *   the keyboard read it, so a key and a palette entry can never disagree. A
 *   command that does not apply now stays listed and says why.
 */

import type { AppState } from "../state/app-state.ts";
import type { Preferences, PreferenceStore } from "../state/preferences.ts";
import { PANELS, panelOf } from "./panels.tsx";
import {
  type Direction,
  goToShortcut,
  type Shortcut,
  SHORTCUTS,
} from "./shortcuts.ts";
import type { WorkspaceView } from "./workspace-view.ts";
import type { Workspace } from "./workspace.ts";

/** The palette's groups, in order; a command's group must be one of them. */
export const COMMAND_GROUPS = [
  "Panels",
  "Runs",
  "Window",
  "Layout",
  "View",
  "Ork",
] as const;

export type CommandGroup = (typeof COMMAND_GROUPS)[number];

export type Command = {
  id: string;
  title: string;
  group: CommandGroup;
  run: () => void;
  shortcut?: Shortcut;
  /** Why it cannot run now; absent when it can. */
  disabled?: string | undefined;
  /** What it does, when its title doesn't say enough. */
  detail?: string;
};

const NEEDS_DOCK = "Needs a wider window.";
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
  PANELS.map((panel, index) => {
    const command: Command = {
      id: `go-${panel.id}`,
      title: `Go to ${panel.title}`,
      group: "Panels",
      run: () => {
        workspace.goTo(panel.id);
      },
    };
    const shortcut = goToShortcut(index + 1);
    if (shortcut !== undefined) command.shortcut = shortcut;
    return command;
  });

const followUpCommands = (workspace: Workspace, state: AppState): Command[] => [
  {
    id: "follow-ups-due",
    title: "Follow-ups: show due",
    group: "Panels",
    run: () => {
      void state.followUpsFilter.setValue({
        ...state.followUpsFilter.getValue(),
        status: "due",
      });
      workspace.goTo("followups");
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>("[data-followups-list]")?.focus();
      });
    },
  },
];

const runCommands = (state: AppState): Command[] => [
  {
    id: "run-workflow",
    title: "Run workflow…",
    group: "Runs",
    run: () => {
      void state.runDialog.setValue(true);
    },
  },
];

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

type ViewKey = "theme" | "density" | "motion";

/** One View preference's commands: each sets it, the one in use says so. */
const choicesOf =
  (workspace: Workspace, preferences: PreferenceStore, chosen: Preferences) =>
  <K extends ViewKey>(
    key: K,
    word: string,
    choices: readonly (readonly [Preferences[K], string])[],
  ): Command[] =>
    choices.map(([value, title]) => ({
      id: `${key}-${value}`,
      title: `${word}: ${title}`,
      group: "View",
      run: () => {
        preferences.update({ [key]: value });
        workspace.announce(`${word}: ${title}.`);
      },
      disabled:
        chosen[key] === value
          ? `This is the ${word.toLowerCase()} now.`
          : undefined,
    }));

const viewCommands = (
  workspace: Workspace,
  preferences: PreferenceStore,
  chosen: Preferences,
): Command[] => {
  const of = choicesOf(workspace, preferences, chosen);
  return [
    ...of("theme", "Theme", [
      ["system", "Follow the system"],
      ["dark", "Dark"],
      ["light", "Light"],
    ]),
    ...of("density", "Density", [
      ["compact", "Compact"],
      ["comfortable", "Comfortable"],
    ]),
    ...of("motion", "Motion", [
      ["system", "Follow the system"],
      ["reduce", "Reduce"],
    ]),
  ];
};

const orkCommands = (state: AppState): Command[] => [
  {
    id: "upgrade-ork",
    title: "Upgrade Ork…",
    group: "Ork",
    detail: "Asks the registry for a new version now.",
    run: () => {
      state.version.openDialog("ask");
    },
  },
];

export const commandsFor = (
  workspace: Workspace,
  view: WorkspaceView,
  state: AppState,
  chosen: Preferences,
): Command[] => [
  ...panelCommands(workspace),
  ...followUpCommands(workspace, state),
  ...runCommands(state),
  ...windowCommands(workspace, view),
  ...layoutCommands(workspace, view),
  ...viewCommands(workspace, state.preferences, chosen),
  ...orkCommands(state),
];
