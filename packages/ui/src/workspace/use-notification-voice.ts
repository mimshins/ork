/**
 * @file What happens when a notification comes, wherever the panels are: it is
 *   said through the live region, and sent to the desktop if the user chose
 *   that.
 */

import { useEffect } from "react";

import { useAppState } from "../state/context.tsx";
import { showOnDesktop } from "../state/desktop.ts";
import type { Workspace } from "./workspace.ts";

export const useNotificationVoice = (workspace: Workspace): void => {
  const state = useAppState();
  useEffect(
    () =>
      state.notifications.onNew(fresh => {
        workspace.announce(fresh.map(({ title }) => title).join(" "));
        if (!state.preferences.value.getValue().desktopNotifications) return;
        for (const item of fresh) {
          showOnDesktop(item.title, item.id, () => {
            state.selectRun(item.runId);
            workspace.goTo("notifications");
          });
        }
      }),
    [state, workspace],
  );
};
