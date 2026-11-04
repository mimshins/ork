/**
 * @file The workspace's top bar: the mark, the Window menu and the palette's
 *   button.
 */

import { Kbd } from "../components/bits.tsx";
import { Button } from "../components/button.tsx";
import { IconSearch } from "../components/icons.tsx";
import { platformIsMac } from "./keys.ts";
import { NotificationBell } from "./notification-bell.tsx";
import { keysOf, SHORTCUTS } from "./shortcuts.ts";
import { WindowMenu } from "./window-menu.tsx";
import type { Workspace } from "./workspace.ts";

import styles from "./workspace.module.css";

export const TopBar = ({ workspace }: { workspace: Workspace }) => (
  <header className={styles["bar"]}>
    <h1 className={styles["name"]}>
      <img
        alt="Ork"
        className={styles["logoOnDark"]}
        src="/ork-wordmark-small.svg"
      />
      <img
        alt="Ork"
        className={styles["logoOnLight"]}
        src="/ork-wordmark-small-on-light.svg"
      />
    </h1>
    <WindowMenu workspace={workspace} />
    <div className={styles["spacer"]} />
    <NotificationBell workspace={workspace} />
    <Button
      onClick={() => {
        void workspace.palette.setValue(true);
      }}
      variant="ghost"
    >
      <IconSearch />
      Commands
      <Kbd keys={keysOf(SHORTCUTS.palette, platformIsMac())} />
    </Button>
  </header>
);
