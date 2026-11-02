/**
 * @file The command palette: a dialog holding the search over the commands. It
 *   waits for the dialog to finish closing before it runs the chosen command,
 *   so the command can place focus where it wants.
 */

import { Dialog } from "@base-ui/react/dialog";
import { useRef } from "react";
import { useValue } from "react-containerized-state";

import { CommandList } from "./command-list.tsx";
import type { Command } from "./commands.ts";
import type { Workspace } from "./workspace.ts";

import dialog from "../components/dialog.module.css";
import styles from "./palette.module.css";

export const Palette = ({
  workspace,
  commands,
}: {
  workspace: Workspace;
  commands: readonly Command[];
}) => {
  const open = useValue(workspace.palette);
  const chosen = useRef<Command | null>(null);
  const setOpen = (next: boolean): void => {
    void workspace.palette.setValue(next);
  };
  return (
    <Dialog.Root
      onOpenChange={setOpen}
      onOpenChangeComplete={stillOpen => {
        if (stillOpen) return;
        const command = chosen.current;
        chosen.current = null;
        command?.run();
      }}
      open={open}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className={dialog["backdrop"]} />
        <Dialog.Popup
          aria-label="Command palette"
          className={styles["palette"]}
        >
          <CommandList
            commands={commands}
            onChoose={command => {
              chosen.current = command;
              setOpen(false);
            }}
          />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
