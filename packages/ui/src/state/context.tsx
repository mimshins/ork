/**
 * @file How a component reaches the page's state: it holds one app state from
 *   the app's root, and retains a run's feed for as long as it shows that run.
 */

import { createContext, useContext, useEffect, useMemo } from "react";

import type { AppState } from "./app-state.ts";
import type { RunFeed } from "./run-feed.ts";

const AppStateContext = createContext<AppState | null>(null);

export const AppStateProvider = AppStateContext.Provider;

export const useAppState = (): AppState => {
  const state = useContext(AppStateContext);
  if (state === null) throw new Error("No AppStateProvider above this.");
  return state;
};

/** The run's feed, read for as long as this component shows it. */
export const useRunFeed = (runId: string | null): RunFeed | null => {
  const state = useAppState();
  useEffect(
    () => (runId === null ? undefined : state.retainRun(runId)),
    [state, runId],
  );
  return useMemo(
    () => (runId === null ? null : state.feedOf(runId)),
    [state, runId],
  );
};
