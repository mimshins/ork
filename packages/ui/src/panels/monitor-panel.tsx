/**
 * @file The Monitor: shows the run chosen, and when a button inside it opens
 *   another, lets that one know so the focus can follow.
 */

import { useCallback, useRef } from "react";
import { useValue } from "react-containerized-state";

import { EmptyState } from "../components/bits.tsx";
import { useAppState } from "../state/context.tsx";
import { RunMonitor } from "./run-monitor.tsx";

export const MonitorPanel = () => {
  const state = useAppState();
  const { run: runId } = useValue(state.selection);
  const runs = useValue(state.runs);
  const run = runs?.find(({ id }) => id === runId);
  /** The next run shown was opened from here, and should take the focus. */
  const arriving = useRef(false);
  const openRun = useCallback(
    (id: string) => {
      arriving.current = true;
      state.selectRun(id);
    },
    [state],
  );
  const takeArrival = useCallback(() => {
    const arrived = arriving.current;
    arriving.current = false;
    return arrived;
  }, []);
  return run === undefined ? (
    <EmptyState title="No run chosen.">
      Choose one in the Runs panel, or use <code>ork tree &lt;run&gt;</code>.
    </EmptyState>
  ) : (
    <RunMonitor
      key={run.id}
      onOpenRun={openRun}
      run={run}
      takeArrival={takeArrival}
    />
  );
};
