/**
 * @file The workspace's status bar: what the page knows of the server, how much
 *   is going on, and the live region that speaks the workspace's changes.
 */

import { useComputedValue, useValue } from "react-containerized-state";

import { CodeText } from "../components/code-text.tsx";
import { describeConnection, liveRuns } from "../state/app-state.ts";
import { useAppState } from "../state/context.tsx";
import type { Workspace } from "./workspace.ts";

import styles from "./workspace.module.css";

const counted = (count: number, one: string, many: string): string =>
  `${String(count)} ${count === 1 ? one : many}`;

/** How much is going on. Not a live region: it changes too often to read out. */
const Counts = () => {
  const { runs, decisions, connection } = useAppState();
  const live = useComputedValue(runs, liveRuns);
  const open = useComputedValue(decisions, list => list?.length ?? null);
  const linked = useComputedValue(connection, ({ link }) => link === "open");
  return linked && live !== null && open !== null ? (
    <span className={styles["status"]}>
      {counted(live, "run live", "runs live")},{" "}
      {counted(open, "decision open", "decisions open")}
    </span>
  ) : null;
};

export const StatusBar = ({ workspace }: { workspace: Workspace }) => {
  const message = useValue(workspace.announcement);
  const { connection } = useAppState();
  const status = useComputedValue(connection, describeConnection);
  return (
    <footer className={styles["bar"]}>
      <output className={styles["status"]}>
        <CodeText text={status} />
      </output>
      <Counts />
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
