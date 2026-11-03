/**
 * @file The top bar's bell: how many notifications are unread, in its name and
 *   on its face, and the way to the panel that lists them.
 */

import { useComputedValue } from "react-containerized-state";

import { IconButton } from "../components/button.tsx";
import { IconNotifications } from "../components/icons.tsx";
import { useAppState } from "../state/context.tsx";
import type { Workspace } from "./workspace.ts";

import styles from "./workspace.module.css";

export const NotificationBell = ({ workspace }: { workspace: Workspace }) => {
  const { notifications } = useAppState();
  const unread = useComputedValue(notifications.view, view => view.unread);
  return (
    <IconButton
      label={
        unread === 0
          ? "Notifications"
          : `Notifications, ${String(unread)} unread`
      }
      onClick={() => {
        workspace.goTo("notifications");
      }}
    >
      <IconNotifications />
      {unread === 0 ? null : (
        <span className={styles["count"]}>{unread > 99 ? "99+" : unread}</span>
      )}
    </IconButton>
  );
};
