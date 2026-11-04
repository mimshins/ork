/**
 * @file The Notifications panel: what has happened across runs, newest first,
 *   with what is unread said in a word as well as marked. Opening one goes to
 *   the panel that deals with it, and when the one holding the focus goes, the
 *   focus moves to the next one. Desktop notifications are the user's to turn
 *   on.
 */

import { useState } from "react";
import { useValue } from "react-containerized-state";

import { EmptyState } from "../components/bits.tsx";
import { Button } from "../components/button.tsx";
import { Switch } from "../components/checkbox.tsx";
import { useAppState } from "../state/context.tsx";
import { askForDesktop } from "../state/desktop.ts";
import { NotificationRow } from "./notification-row.tsx";
import { useKeptFocus } from "./use-kept-focus.ts";

import styles from "./notifications.module.css";

const REFUSED: Readonly<Record<"denied" | "unsupported", string>> = {
  denied:
    "The browser refused. Allow notifications for this page in its settings.",
  unsupported: "This browser has no desktop notifications.",
};

export const NotificationsPanel = () => {
  const { notifications, preferences } = useAppState();
  const { items, unread } = useValue(notifications.view);
  const { desktopNotifications } = useValue(preferences.value);
  const [refused, setRefused] = useState<string | null>(null);
  const { panel, onFocus } = useKeptFocus(
    items.map(({ id }) => id).join("\n"),
    "[data-notification]",
  );

  const setDesktop = async (on: boolean): Promise<void> => {
    setRefused(null);
    if (!on) {
      preferences.update({ desktopNotifications: false });
      return;
    }
    const answer = await askForDesktop();
    if (answer === "granted")
      preferences.update({ desktopNotifications: true });
    else setRefused(REFUSED[answer]);
  };

  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- notes where the focus is
    <div
      aria-label="Notifications"
      className={styles["panel"]}
      onFocus={onFocus}
      ref={panel}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- where the focus can land, not a landmark: the dock names the panel
      role="group"
      tabIndex={-1}
    >
      <div className={styles["tools"]}>
        <Switch
          checked={desktopNotifications}
          label="Desktop notifications"
          onChange={on => {
            void setDesktop(on);
          }}
        />
        <Button
          disabled={unread === 0}
          focusableWhenDisabled
          onClick={notifications.markAllRead}
          variant="ghost"
        >
          Mark all read
        </Button>
      </div>
      <div className={styles["main"]}>
        {refused === null ? null : (
          <p
            className={styles["refused"]}
            role="alert"
          >
            {refused}
          </p>
        )}
        {items.length === 0 ? (
          <EmptyState title="Nothing yet.">
            Decisions, and runs that end, crash or pause, land here.
          </EmptyState>
        ) : (
          <ul className={styles["list"]}>
            {items.map(item => (
              <NotificationRow
                item={item}
                key={item.id}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
