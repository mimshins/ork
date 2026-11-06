/**
 * @file The Window menu: every panel with whether it is open, minimized or
 *   closed, and Reset layout. Choosing a panel goes to it, bringing it back if
 *   it has to.
 */

import { useValue } from "react-containerized-state";

import { Button } from "../components/button.tsx";
import { IconChevronDown } from "../components/icons.tsx";
import { Menu, type MenuEntry } from "../components/menu.tsx";
import { platformIsMac } from "./keys.ts";
import { type PanelId, PANELS } from "./panels.tsx";
import { goToShortcut, keysOf, type Shortcut } from "./shortcuts.ts";
import type { WorkspaceView } from "./workspace-view.ts";
import type { Workspace } from "./workspace.ts";

const hintOf = (shortcut: Shortcut | undefined, mac: boolean) =>
  shortcut === undefined
    ? undefined
    : keysOf(shortcut, mac).join(mac ? "" : "+");

const stateOf = (view: WorkspaceView, id: PanelId): string | undefined => {
  if (!view.wide) return undefined;
  if (view.open.includes(id)) return undefined;
  return view.minimized.includes(id) ? "minimized" : "closed";
};

export const WindowMenu = ({ workspace }: { workspace: Workspace }) => {
  const view = useValue(workspace.view);
  const mac = platformIsMac();
  const entries: MenuEntry[] = [
    ...PANELS.map(({ id, title }, index) => ({
      label: title,
      detail: stateOf(view, id),
      hint: hintOf(goToShortcut(index + 1), mac),
      onSelect: () => {
        workspace.goTo(id);
      },
    })),
    "separator",
    {
      label: "Reset layout",
      onSelect: () => {
        workspace.resetLayout();
      },
    },
  ];
  return (
    <Menu
      entries={entries}
      trigger={
        <Button variant="ghost">
          Window
          <IconChevronDown />
        </Button>
      }
    />
  );
};
