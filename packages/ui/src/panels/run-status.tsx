/**
 * @file A run's standing in the Monitor's header: its status, and, when it has
 *   open decisions, a button that says how many wait and opens the Decisions
 *   panel filtered to this run (the icon is beside the words, not color
 *   alone).
 */

import { use } from "react";
import { useValue } from "react-containerized-state";

import { Button } from "../components/button.tsx";
import { IconAlert } from "../components/icons.tsx";
import { StatusBadge } from "../components/status-badge.tsx";
import { useAppState } from "../state/context.tsx";
import { WorkspaceContext } from "../workspace/context.ts";
import { runStatusOf } from "./monitor-model.ts";
import type { RunView } from "./use-run-monitor.ts";

export const RunStatus = ({
  run,
  waiting,
}: {
  run: RunView;
  /** A node of it has a question open. */
  waiting: boolean;
}) => {
  const state = useAppState();
  const workspace = use(WorkspaceContext);
  const decisions = useValue(state.decisions)?.filter(
    ({ runId }) => runId === run.id,
  ).length;
  return (
    <>
      <StatusBadge
        pill
        status={runStatusOf(run, waiting)}
      />
      {decisions === undefined || decisions === 0 ? null : (
        <Button
          cli={`ork decide ${run.id} --list`}
          onClick={() => {
            state.preferences.update({ decisionFilter: { run: run.id } });
            workspace?.goTo("decisions");
          }}
          tip="Open Decisions, filtered to this run."
          variant="ghost"
        >
          <IconAlert />
          {decisions === 1 ? "1 decision" : `${decisions} decisions`} waiting
        </Button>
      )}
    </>
  );
};
