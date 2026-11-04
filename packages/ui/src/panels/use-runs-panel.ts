/**
 * @file What the Runs panel reads besides the runs: who's waiting, and the
 *   projects.
 */

import { useEffect } from "react";
import { useComputedValue, useValue } from "react-containerized-state";

import type { AppState } from "../state/app-state.ts";

export const useWaitingRuns = (state: AppState): ReadonlySet<string> =>
  useComputedValue(
    state.decisions,
    list => new Set((list ?? []).map(({ runId }) => runId)),
  );

export const useProjectList = (state: AppState) => {
  const projects = useValue(state.projects.state);
  useEffect(() => {
    void state.projects.load();
  }, [state]);
  return projects.status === "ready" ? projects.data : [];
};
