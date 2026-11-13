/**
 * @file What the Runs panel reads besides the runs the stream sends: who's
 *   waiting, the projects, and (with a filter set) the server's own list.
 */

import type { QueryOf, RunView } from "@krapht/ork-server/client";
import { useEffect, useState } from "react";
import { useComputedValue, useValue } from "react-containerized-state";

import { type FilterValues, isFiltered } from "../components/filter-model.ts";
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

/** The table's fields as `GET /api/runs` takes them, the set ones only. */
export const runsQuery = (values: FilterValues): QueryOf<"runs"> => ({
  ...(values["status"] === undefined ? {} : { status: values["status"] }),
  ...(values["workflow"] === undefined ? {} : { workflow: values["workflow"] }),
  ...(values["project"] === undefined ? {} : { project: values["project"] }),
  ...(values["since"] === undefined ? {} : { since: values["since"] }),
  ...(values["until"] === undefined ? {} : { until: values["until"] }),
});

export type FilteredRuns = {
  /** Whether a filter is set; the panel shows the stream's runs when not. */
  filtered: boolean;
  /**
   * The server's answer for the filter, the last good one while a newer is
   * read.
   */
  rows: readonly RunView[] | null;
  busy: boolean;
  /** The server's 400 for the filter. */
  refused: string | null;
  /** Any other failure of the read. */
  failed: string | null;
};

/** What the server said, and the values it said it for. */
type Answer = Omit<FilteredRuns, "busy" | "filtered"> & {
  values: FilterValues;
};

const NO_ANSWER: Answer = {
  values: {},
  rows: null,
  refused: null,
  failed: null,
};

/**
 * What `GET /api/runs` answers for the filter, read again when a run starts,
 * ends or changes (the stream says so). Unfiltered it reads nothing: the panel
 * shows the stream's runs.
 */
export const useFilteredRuns = (
  state: AppState,
  values: FilterValues,
): FilteredRuns => {
  const filtered = isFiltered(values);
  const stamp = useComputedValue(
    state.runs,
    list => list?.map(run => `${run.id}:${run.live}`).join() ?? "",
  );
  const [answer, setAnswer] = useState<Answer>(NO_ANSWER);
  const [wasFiltered, setWasFiltered] = useState(filtered);
  if (wasFiltered !== filtered) {
    // A cleared filter forgets its rows, so the next one doesn't show them.
    setWasFiltered(filtered);
    if (!filtered) setAnswer(NO_ANSWER);
  }
  useEffect(() => {
    let current = true;
    const read = async (): Promise<void> => {
      const result = await state.client.call("runs", {
        query: runsQuery(values),
      });
      if (!current) return;
      const refused = !result.ok && result.status === 400;
      setAnswer(before => ({
        values,
        rows: result.ok ? result.data : before.rows,
        refused: refused ? result.error : null,
        failed: result.ok || refused ? null : result.error,
      }));
    };
    if (filtered) void read();
    return () => {
      current = false;
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- `stamp` is a reason to read again
  }, [state, filtered, values, stamp]);
  return {
    filtered,
    rows: filtered ? answer.rows : null,
    busy: filtered && answer.values !== values,
    refused: filtered ? answer.refused : null,
    failed: filtered ? answer.failed : null,
  };
};
