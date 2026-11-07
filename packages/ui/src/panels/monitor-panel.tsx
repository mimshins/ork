/** @file The Monitor: shows the run chosen. */

import { useValue } from "react-containerized-state";

import { EmptyState } from "../components/bits.tsx";
import { useAppState } from "../state/context.tsx";
import { RunMonitor } from "./run-monitor.tsx";

export const MonitorPanel = () => {
  const state = useAppState();
  const { run: runId } = useValue(state.selection);
  const runs = useValue(state.runs);
  const run = runs?.find(({ id }) => id === runId);
  return run === undefined ? (
    <EmptyState
      cli="ork tree <run>"
      title="No run chosen."
    >
      Choose one in the Runs panel, or in a terminal:
    </EmptyState>
  ) : (
    <RunMonitor
      key={run.id}
      run={run}
    />
  );
};
