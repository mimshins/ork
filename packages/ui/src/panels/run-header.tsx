/**
 * @file The Monitor's stat strip: which run this is, what it has spent against
 *   its budget, how many nodes are done and how long it has taken, how it
 *   stands, its caller if a `workflow.call` started it, and the run's controls.
 *   The button that opened a run goes with the run it was on, so focus lands on
 *   this heading instead of falling out of the panel, as it does after the Run
 *   workflow dialog starts one.
 */

import { useEffect, useRef } from "react";

import { Button } from "../components/button.tsx";
import { StatusBadge } from "../components/status-badge.tsx";
import type { NodeFacts } from "../graph/facts.ts";
import { useAppState } from "../state/context.tsx";
import { runActions, runStatusOf } from "./monitor-model.ts";
import { RunControls } from "./run-controls.tsx";
import { RunStats } from "./run-stats.tsx";
import type { RunView } from "./use-run-monitor.ts";

import styles from "./monitor.module.css";

export const RunHeader = ({
  run,
  waiting,
  facts,
  budgetUsd,
  now,
}: {
  run: RunView;
  /** A node of it has a question open. */
  waiting: boolean;
  facts: ReadonlyMap<string, NodeFacts>;
  /** What it may spend, if there's a limit. */
  budgetUsd: number | undefined;
  now: number;
}) => {
  const state = useAppState();
  const heading = useRef<HTMLHeadingElement>(null);
  const { parent } = run;
  useEffect(() => {
    if (state.takeArrival(run.id)) heading.current?.focus();
  }, [state, run.id]);
  return (
    <header className={styles["header"]}>
      <div className={styles["stat"]}>
        <span className={styles["statName"]}>Run</span>
        <span className={styles["statValue"]}>
          <h2
            className={styles["title"]}
            data-run-heading={run.id}
            ref={heading}
            tabIndex={-1}
          >
            {run.workflow}
          </h2>
          <code className={styles["runId"]}>{run.id}</code>
        </span>
      </div>
      <RunStats
        budgetUsd={budgetUsd}
        facts={facts}
        now={now}
        run={run}
      />
      <StatusBadge
        pill
        status={runStatusOf(run, waiting)}
      />
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
