/**
 * @file The rows of the Runs panel, and what it says with none. One row is a
 *   run: its workflow and status, then its id, when it started, what it cost,
 *   and what is paused in it. A row re-renders only when its own run changes,
 *   since a run that did not change keeps its object.
 */

import type { RunView } from "@krapht/ork-server/client";
import { memo } from "react";

import { EmptyState } from "../components/bits.tsx";
import { Button } from "../components/button.tsx";
import { IconPlay } from "../components/icons.tsx";
import { type Status, StatusBadge } from "../components/status-badge.tsx";
import { formatCost } from "../graph/facts.ts";
import type { AppState } from "../state/app-state.ts";

import styles from "./runs.module.css";

const statusOf = (run: RunView, waiting: boolean): Status =>
  run.live === "running" && waiting ? "waiting" : run.live;

export const timeOf = (iso: string): string => {
  const at = new Date(iso);
  const today = at.toDateString() === new Date().toDateString();
  return at.toLocaleString(
    undefined,
    today
      ? { hour: "2-digit", minute: "2-digit", second: "2-digit" }
      : { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" },
  );
};

const heldOf = ({ paused, live }: RunView): string | null => {
  const count = paused.nodes.length;
  if (live !== "running" || count === 0) return null;
  return count === 1 ? "1 node paused" : `${String(count)} nodes paused`;
};

type RunRowProps = {
  run: RunView;
  selected: boolean;
  tabStop: boolean;
  waiting: boolean;
  onSelect: AppState["selectRun"];
};

export const RunRow = memo(
  ({ run, selected, tabStop, waiting, onSelect }: RunRowProps) => {
    const held = heldOf(run);
    return (
      <li>
        <button
          aria-current={selected ? "true" : undefined}
          className={styles["row"]}
          onClick={() => {
            onSelect(run.id);
          }}
          tabIndex={tabStop ? 0 : -1}
          type="button"
        >
          <span className={styles["rowTop"]}>
            <span className={styles["workflow"]}>{run.workflow}</span>
            <StatusBadge status={statusOf(run, waiting)} />
          </span>
          <span className={styles["rowMeta"]}>
            <span>{run.id}</span>
            <time dateTime={run.startedAt}>{timeOf(run.startedAt)}</time>
            <span>{formatCost(run.costUsd)}</span>
            {held === null ? null : <span>{held}</span>}
          </span>
        </button>
      </li>
    );
  },
);
RunRow.displayName = "RunRow";

/** The way to start a run. */
export const RunWorkflowButton = ({ onClick }: { onClick: () => void }) => (
  <Button
    cli="ork run <workflow>"
    onClick={onClick}
    variant="primary"
  >
    <IconPlay />
    Run workflow
  </Button>
);

/** What the list says with nothing to show, and the next step. */
export const NoRuns = ({ filtered }: { filtered: boolean }) =>
  filtered ? (
    <EmptyState
      cli="ork ps"
      title="No runs in this project."
    >
      Among the newest 50. For older ones:
    </EmptyState>
  ) : (
    <EmptyState
      cli="ork run <workflow>"
      title="No runs yet."
    >
      Start one with Run workflow, or in a terminal:
    </EmptyState>
  );
