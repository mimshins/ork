/**
 * @file The panels when the window is too narrow for a dock, including a wide
 *   window at 200% zoom: one column in the panel list's order, each panel under
 *   a heading whose button folds it. The saved dock is left as it was, for when
 *   the window grows again.
 */

import { useValue } from "react-containerized-state";

import { IconChevronDown, IconChevronRight } from "../components/icons.tsx";
import { PANELS } from "./panels.tsx";
import { stackHeadingId } from "./workspace-view.ts";
import type { Workspace } from "./workspace.ts";

import styles from "./workspace.module.css";

export const Stack = ({ workspace }: { workspace: Workspace }) => {
  const { folded } = useValue(workspace.view);
  return (
    <div className={styles["stack"]}>
      {PANELS.map(({ id, title, Icon, Body }) => {
        const open = !folded.includes(id);
        const bodyId = `${stackHeadingId(id)}-body`;
        return (
          <section
            aria-labelledby={stackHeadingId(id)}
            className={styles["stacked"]}
            key={id}
          >
            <h2 className={styles["stackedHeading"]}>
              <button
                aria-controls={open ? bodyId : undefined}
                aria-expanded={open}
                className={styles["stackedButton"]}
                id={stackHeadingId(id)}
                onClick={() => {
                  workspace.toggleFold(id);
                }}
                type="button"
              >
                {open ? <IconChevronDown /> : <IconChevronRight />}
                <Icon />
                {title}
              </button>
            </h2>
            {open ? (
              <div
                className={styles["stackedBody"]}
                id={bodyId}
              >
                <Body />
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
};
