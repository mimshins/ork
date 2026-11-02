/**
 * @file The rail: the minimized panels, as a column of icon buttons at the
 *   workspace's edge. A button puts its panel back where it was. The rail takes
 *   no room when nothing is minimized.
 */

import { useValue } from "react-containerized-state";

import { IconButton } from "../components/button.tsx";
import { panelOf } from "./panels.tsx";
import { railButtonId } from "./workspace-view.ts";
import type { Workspace } from "./workspace.ts";

import styles from "./workspace.module.css";

export const Rail = ({ workspace }: { workspace: Workspace }) => {
  const { minimized } = useValue(workspace.view);
  if (minimized.length === 0) return null;
  return (
    <nav
      aria-label="Minimized panels"
      className={styles["rail"]}
    >
      {minimized.map(id => {
        const { title, Icon } = panelOf(id);
        return (
          <IconButton
            id={railButtonId(id)}
            key={id}
            label={`Restore ${title}`}
            onClick={() => {
              workspace.restore(id);
            }}
          >
            <Icon />
          </IconButton>
        );
      })}
    </nav>
  );
};
