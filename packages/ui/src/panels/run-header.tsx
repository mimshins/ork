/**
 * @file The Monitor's header: which run this is, how it stands and what it has
 *   cost, its caller if a `workflow.call` started it, and the run's controls.
 *   The button that opened a run goes with the run it was on, so focus lands on
 *   this heading instead of falling out of the panel.
 */

import { useEffect, useRef } from "react";

import { Button } from "../components/button.tsx";
import { StatusBadge } from "../components/status-badge.tsx";
import { formatCost } from "../graph/facts.ts";
import { runActions } from "./monitor-model.ts";
import { RunControls } from "./run-controls.tsx";
import type { RunView } from "./use-run-monitor.ts";

import styles from "./monitor.module.css";

export const RunHeader = ({
  run,
  takeArrival,
  onOpenRun,
}: {
  run: RunView;
  /** Whether a button in the Monitor opened this run: asking clears it. */
  takeArrival: () => boolean;
  onOpenRun: (run: string) => void;
}) => {
  const heading = useRef<HTMLHeadingElement>(null);
  const { parent } = run;
  useEffect(() => {
    if (takeArrival()) heading.current?.focus();
  }, [takeArrival]);
  return (
    <header className={styles["header"]}>
      <h2
        className={styles["title"]}
        ref={heading}
        tabIndex={-1}
      >
        {run.workflow}
      </h2>
      <code className={styles["runId"]}>{run.id}</code>
      <StatusBadge status={run.live} />
      <span className={styles["cost"]}>{formatCost(run.costUsd)}</span>
      {parent === undefined ? null : (
        <Button
          onClick={() => {
            onOpenRun(parent);
          }}
          variant="ghost"
        >
          Called by {parent}
        </Button>
      )}
      <RunControls
        actions={runActions(run)}
        runId={run.id}
      />
    </header>
  );
};
