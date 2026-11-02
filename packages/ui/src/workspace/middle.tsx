/**
 * @file The workspace's middle: the rail and the dock, or the stack when the
 *   window is too narrow. It keeps the workspace told of the window's width.
 */

import { useEffect } from "react";
import { useValue } from "react-containerized-state";

import { Dock } from "./dock.tsx";
import { Rail } from "./rail.tsx";
import { Stack } from "./stack.tsx";
import { WIDE_QUERY } from "./workspace-view.ts";
import type { Workspace } from "./workspace.ts";

import styles from "./workspace.module.css";

const useViewport = (workspace: Workspace): void => {
  useEffect(() => {
    const query = window.matchMedia(WIDE_QUERY);
    const update = (): void => {
      workspace.setWide(query.matches);
    };
    update();
    query.addEventListener("change", update);
    return () => {
      query.removeEventListener("change", update);
    };
  }, [workspace]);
};

export const Middle = ({ workspace }: { workspace: Workspace }) => {
  const { wide } = useValue(workspace.view);
  useViewport(workspace);
  return (
    <main className={styles["middle"]}>
      {wide ? (
        <>
          <Rail workspace={workspace} />
          <div className={styles["dockArea"]}>
            <Dock workspace={workspace} />
          </div>
        </>
      ) : (
        <Stack workspace={workspace} />
      )}
    </main>
  );
};
