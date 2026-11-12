/**
 * @file The rail: the minimized panels, as a column of icon buttons at the
 *   workspace's edge. A button puts its panel back where it was. The rail takes
 *   no room when nothing is minimized.
 */

import { useValue } from "react-containerized-state";

import { IconButton } from "../components/button.tsx";
import { useDueName } from "../panels/followups-count.tsx";
import { type PanelId, panelOf } from "./panels.tsx";
import { railButtonId } from "./workspace-view.ts";
import type { Workspace } from "./workspace.ts";

import styles from "./workspace.module.css";

const Restore = ({
  id,
  name,
  workspace,
}: {
  id: PanelId;
  name: string;
  workspace: Workspace;
}) => {
  const { Icon } = panelOf(id);
  return (
    <IconButton
      id={railButtonId(id)}
      label={`Restore ${name}`}
      onClick={() => {
        workspace.restore(id);
      }}
    >
      <Icon />
    </IconButton>
  );
};

/** Follow-ups carries its due count in its name, which needs the page's state. */
const FollowUpsRestore = ({ workspace }: { workspace: Workspace }) => (
  <Restore
    id="followups"
    name={useDueName(panelOf("followups").title)}
    workspace={workspace}
  />
);

const RailButton = ({ id, workspace }: { id: PanelId; workspace: Workspace }) =>
  id === "followups" ? (
    <FollowUpsRestore workspace={workspace} />
  ) : (
    <Restore
      id={id}
      name={panelOf(id).title}
      workspace={workspace}
    />
  );

export const Rail = ({ workspace }: { workspace: Workspace }) => {
  const { minimized } = useValue(workspace.view);
  if (minimized.length === 0) return null;
  return (
    <nav
      aria-label="Minimized panels"
      className={styles["rail"]}
    >
      {minimized.map(id => (
        <RailButton
          id={id}
          key={id}
          workspace={workspace}
        />
      ))}
    </nav>
  );
};
