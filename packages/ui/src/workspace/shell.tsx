/**
 * @file The workspace's frame: the bars around the middle, the palette, and the
 *   keys that reach them. The commands come from one list, rebuilt when the
 *   view changes, so what a key does and what the palette shows stay the same.
 */

import { useMemo } from "react";
import { useValue } from "react-containerized-state";

import { StatusBar, TopBar } from "./bars.tsx";
import { commandsFor } from "./commands.ts";
import { useWorkspaceKeys } from "./keys.ts";
import { Middle } from "./middle.tsx";
import { Palette } from "./palette.tsx";
import type { Workspace } from "./workspace.ts";

import styles from "./workspace.module.css";

export const Shell = ({
  workspace,
  status,
}: {
  workspace: Workspace;
  status: string;
}) => {
  const view = useValue(workspace.view);
  const commands = useMemo(
    () => commandsFor(workspace, view),
    [workspace, view],
  );
  useWorkspaceKeys(workspace, commands);
  return (
    <div className={styles["shell"]}>
      <TopBar workspace={workspace} />
      <Middle workspace={workspace} />
      <StatusBar
        status={status}
        workspace={workspace}
      />
      <Palette
        commands={commands}
        workspace={workspace}
      />
    </div>
  );
};
