/**
 * @file The workspace's keyboard handler: one listener on the window that runs
 *   the command a key combination names, and opens the palette. Every
 *   combination holds a modifier, so plain typing never triggers one (WCAG
 *   2.1.4). A disabled command's key does nothing but say why, and no key works
 *   behind a modal. It listens in the capture phase and stops a key it runs, so
 *   a tab strip under focus doesn't also take `⌥⇧` + an arrow as a move to the
 *   next tab (WCAG 2.4.3).
 */

import { useEffect } from "react";

import type { Command } from "./commands.ts";
import { isMac, matches, SHORTCUTS } from "./shortcuts.ts";
import type { Workspace } from "./workspace.ts";

export const platformIsMac = (): boolean => isMac(navigator.platform);

/** A modal has the page: nothing behind it may change, or open over it. */
const aModalIsOpen = (): boolean =>
  document.querySelector("[data-modal]") !== null;

export const useWorkspaceKeys = (
  workspace: Workspace,
  commands: readonly Command[],
): void => {
  useEffect(() => {
    const mac = platformIsMac();
    const onKeyDown = (event: KeyboardEvent): void => {
      const inPalette = workspace.palette.getValue();
      if (!inPalette && aModalIsOpen()) return;
      if (matches(event, SHORTCUTS.palette, mac)) {
        event.preventDefault();
        event.stopPropagation();
        void workspace.palette.setValue(!inPalette);
        return;
      }
      if (inPalette) return;
      const command = commands.find(
        ({ shortcut }) =>
          shortcut !== undefined && matches(event, shortcut, mac),
      );
      if (command === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      if (command.disabled === undefined) command.run();
      else workspace.announce(command.disabled);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [workspace, commands]);
};
