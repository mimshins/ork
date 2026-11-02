/**
 * @file The workspace's frame: the bars around the middle, the palette, and the
 *   keys that reach them. The commands come from one list, so what a key does
 *   and what the palette shows stay the same.
 */

import { RunDialog } from "../panels/run-dialog.tsx";
import { TopBar } from "./bars.tsx";
import { Middle } from "./middle.tsx";
import { Palette } from "./palette.tsx";
import { StatusBar } from "./status-bar.tsx";
import { useCommands } from "./use-commands.ts";
import type { Workspace } from "./workspace.ts";

import styles from "./workspace.module.css";

export const Shell = ({ workspace }: { workspace: Workspace }) => {
  const commands = useCommands(workspace);
  return (
    <div className={styles["shell"]}>
      <TopBar workspace={workspace} />
      <Middle workspace={workspace} />
      <StatusBar workspace={workspace} />
      <Palette
        commands={commands}
        workspace={workspace}
      />
      <RunDialog />
    </div>
  );
};
