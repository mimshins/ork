/**
 * @file The Logs panel: the chosen run's events, live, filtered by node, by
 *   type and by text. The node filter is the shared selection, so choosing a
 *   node in the Monitor opens it here. Scrolling up holds the place, and older
 *   events are read a page at a time.
 */

import { useValue } from "react-containerized-state";

import { EmptyState } from "../components/bits.tsx";
import { useAppState } from "../state/context.tsx";
import { RunLogs } from "./run-logs.tsx";

export const LogsPanel = () => {
  const state = useAppState();
  const { run, node } = useValue(state.selection);
  return run === null ? (
    <EmptyState title="No run chosen.">
      Choose one in the Runs panel, or use <code>ork logs &lt;run&gt;</code>.
    </EmptyState>
  ) : (
    <RunLogs
      key={run}
      node={node}
      runId={run}
    />
  );
};
