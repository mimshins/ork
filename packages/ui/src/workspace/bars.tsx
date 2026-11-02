/**
 * @file The workspace's two bars: the top one with the mark, the Window menu
 *   and the palette's button; and the status one with the server's state and
 *   the live region that speaks the workspace's changes.
 */

import { useValue } from "react-containerized-state";

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

export const StatusBar = ({
  workspace,
  status,
}: {
  workspace: Workspace;
  status: string;
}) => {
  const message = useValue(workspace.announcement);
  return (
    <footer className={styles["bar"]}>
      <output className={styles["status"]}>{status}</output>
      <output
        aria-atomic="true"
        aria-live="polite"
        className={styles["visuallyHidden"]}
      >
        {message}
      </output>
    </footer>
  );
};
