/**
 * @file One item in the Notifications panel. What is unread is said in a word
 *   as well as marked, and opening it goes to the panel that deals with it.
 */

import { use } from "react";

import { Button } from "../components/button.tsx";
import { CodeText } from "../components/code-text.tsx";
import { StatusBadge } from "../components/status-badge.tsx";
import { useAppState } from "../state/context.tsx";
import type { ShownNotification } from "../state/notifications.ts";
import { WorkspaceContext } from "../workspace/context.ts";
import { timeOf } from "./run-row.tsx";

import styles from "./notifications.module.css";

export const NotificationRow = ({ item }: { item: ShownNotification }) => {
  const state = useAppState();
  const workspace = use(WorkspaceContext);
  return (
    <li
      className={styles["item"]}
      data-notification={item.id}
      data-unread={item.unread ? "" : undefined}
    >
      <p className={styles["title"]}>
        <CodeText text={item.title} />
      </p>
      <p className={styles["meta"]}>
        <StatusBadge status={item.status} />
        <span>{timeOf(item.at)}</span>
        {item.unread ? <span className={styles["unread"]}>unread</span> : null}
      </p>
      <p className={styles["actions"]}>
        <Button
          aria-label={`Open: ${item.title}`}
          onClick={() => {
            state.notifications.markRead(item.id);
            state.selectRun(item.runId);
            if (item.node !== undefined) state.selectNode(item.node);
            workspace?.goTo(item.kind === "decision" ? "decisions" : "monitor");
          }}
          variant="ghost"
        >
          Open
        </Button>
        <Button
          aria-label={`Mark read: ${item.title}`}
          disabled={!item.unread}
          focusableWhenDisabled
          onClick={() => {
            state.notifications.markRead(item.id);
          }}
          variant="ghost"
        >
          Mark read
        </Button>
      </p>
    </li>
  );
};
