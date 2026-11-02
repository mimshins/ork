/**
 * @file The workspace's commands as they stand: one list, rebuilt when the view
 *   or the preferences change, with the keys that reach it.
 */

import { useMemo } from "react";
import { useValue } from "react-containerized-state";

import { useAppState } from "../state/context.tsx";
import { type Command, commandsFor } from "./commands.ts";
import { useWorkspaceKeys } from "./keys.ts";
import type { Workspace } from "./workspace.ts";

export const useCommands = (workspace: Workspace): Command[] => {
  const state = useAppState();
  const { preferences } = state;
  const view = useValue(workspace.view);
  const chosen = useValue(preferences.value);
  const commands = useMemo(
    () => commandsFor(workspace, view, state, chosen),
    [workspace, view, state, chosen],
  );
  useWorkspaceKeys(workspace, commands);
  return commands;
};
