/**
 * @file The command palette: a dialog holding the search over the commands. It
 *   waits for the dialog to finish closing before it runs the chosen command,
 *   so the command can place focus where it wants: a chosen command is never
 *   followed by the palette's own return of the focus, which would land behind
 *   a dialog the command opened. A command that leaves the focus nowhere gets
 *   it back where the palette was opened from, or in the panels.
 */

import { Dialog } from "@base-ui/react/dialog";
import { useLayoutEffect, useRef } from "react";
import { useValue } from "react-containerized-state";

import { CommandList } from "./command-list.tsx";
import type { Command } from "./commands.ts";
import type { Workspace } from "./workspace.ts";

import dialog from "../components/dialog.module.css";
import styles from "./palette.module.css";

/** Whether nothing holds the focus, and no dialog is about to take it. */
const focusNowhere = (): boolean =>
  (document.activeElement === null ||
    document.activeElement === document.body) &&
  document.querySelector("[data-modal]") === null;

/** Calls `then` two frames on, once a dialog a command opened has the focus. */
const afterFrames = (then: () => void): void => {
  requestAnimationFrame(() => {
    requestAnimationFrame(then);
  });
};

export const Palette = ({
  workspace,
  commands,
}: {
  workspace: Workspace;
  commands: readonly Command[];
}) => {
  const open = useValue(workspace.palette);
  const chosen = useRef<Command | null>(null);
  // Kept from the choice until the next opening: the palette's return of the
  // focus is decided after the command already ran.
  const ranOne = useRef(false);
  const opener = useRef<Element | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    ranOne.current = false;
    opener.current = document.activeElement;
  }, [open]);
  const setOpen = (next: boolean): void => {
    void workspace.palette.setValue(next);
  };
  const giveBack = (): void => {
    if (!focusNowhere()) return;
    const back = opener.current;
    if (back instanceof HTMLElement && back.isConnected) back.focus();
    else workspace.focusPanels();
  };
  return (
    <Dialog.Root
      onOpenChange={setOpen}
      onOpenChangeComplete={stillOpen => {
        if (stillOpen) return;
        const command = chosen.current;
        chosen.current = null;
        if (command === null) return;
        command.run();
        afterFrames(giveBack);
      }}
      open={open}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className={dialog["backdrop"]} />
        <Dialog.Popup
          aria-label="Command palette"
          aria-modal="true"
          className={styles["palette"]}
          finalFocus={() => !ranOne.current}
        >
          <CommandList
            commands={commands}
            onChoose={command => {
              chosen.current = command;
              ranOne.current = true;
              setOpen(false);
            }}
          />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
