/**
 * @file The Monitor's header: which run this is, how it stands and what it has
 *   cost, its caller if a `workflow.call` started it, and the run's controls.
 *   The button that opened a run goes with the run it was on, so focus lands on
 *   this heading instead of falling out of the panel, as it does after the Run
 *   workflow dialog starts one.
 */

import { useEffect, useRef } from "react";

import { Button } from "../components/button.tsx";
import { StatusBadge } from "../components/status-badge.tsx";
import { formatCost } from "../graph/facts.ts";
import { useAppState } from "../state/context.tsx";
import { runActions, runStatusOf } from "./monitor-model.ts";
import { RunControls } from "./run-controls.tsx";
import type { RunView } from "./use-run-monitor.ts";

import styles from "./monitor.module.css";

export const RunHeader = ({
  run,
  waiting,
}: {
  run: RunView;
  /** A node of it has a question open. */
  waiting: boolean;
}) => {
  const state = useAppState();
  const heading = useRef<HTMLHeadingElement>(null);
  const { parent } = run;
  useEffect(() => {
    if (state.takeArrival(run.id)) heading.current?.focus();
  }, [state, run.id]);
  return (
    <header className={styles["header"]}>
      <h2
        className={styles["title"]}
        data-run-heading={run.id}
        ref={heading}
        tabIndex={-1}
      >
        {run.workflow}
      </h2>
      <code className={styles["runId"]}>{run.id}</code>
      <StatusBadge
        pill
        status={runStatusOf(run, waiting)}
      />
      <span className={styles["cost"]}>{formatCost(run.costUsd)}</span>
      {parent === undefined ? null : (
        <Button
          onClick={() => {
            state.arriveAt(parent);
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
