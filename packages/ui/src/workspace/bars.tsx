/**
 * @file The workspace's top bar: the mark, the Window menu and the palette's
 *   button.
 */

import { Kbd } from "../components/bits.tsx";
import { Button } from "../components/button.tsx";
import { IconSearch } from "../components/icons.tsx";
import { platformIsMac } from "./keys.ts";
import { keysOf, SHORTCUTS } from "./shortcuts.ts";
import { WindowMenu } from "./window-menu.tsx";
import type { Workspace } from "./workspace.ts";

import styles from "./workspace.module.css";

export const TopBar = ({ workspace }: { workspace: Workspace }) => (
  <header className={styles["bar"]}>
    <img
      alt=""
      className={styles["mark"]}
      src="/favicon.svg"
    />
    <h1 className={styles["name"]}>Ork</h1>
    <WindowMenu workspace={workspace} />
    <div className={styles["spacer"]} />
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
