/**
 * @file The Decisions panel's state: the filter values the browser keeps, the
 *   open decisions the overview stream sends while no filter is set and, with
 *   one, what `GET /api/decisions` answers for it (read again whenever the
 *   stream's list changes; a refused value keeps the last list that worked and
 *   says why), and the one line said aloud when a decision settles.
 */

import type { DecisionRecord } from "@krapht/ork-server/client";
import { use, useEffect, useRef, useState } from "react";
import { useValue } from "react-containerized-state";

import { type FilterValues, isFiltered } from "../components/filter-model.ts";
import { useAppState } from "../state/context.tsx";
import { WorkspaceContext } from "../workspace/context.ts";
import { endingOf } from "./decisions-model.ts";

/** The values that are set, as the query. */
const queryOf = (values: FilterValues): Record<string, string> =>
  Object.fromEntries(
    Object.entries(values).flatMap(([name, value]) =>
      value === undefined || value === "" ? [] : [[name, value]],
    ),
  );

type Read = {
  /** The query this answered. */
  key: string;
  rows: readonly DecisionRecord[] | null;
  error: string | null;
};

/** The filter values the browser keeps, and a way to set them. */
export const useDecisionFilter = () => {
  const { value, update } = useAppState().preferences;
  return {
    values: useValue(value).decisionFilter,
    set: (next: FilterValues): void => {
      update({ decisionFilter: queryOf(next) });
    },
  };
};

export const useDecisionsRead = (
  values: FilterValues,
  open: readonly DecisionRecord[],
) => {
  const { client, decisions } = useAppState();
  const [read, setRead] = useState<Read | null>(null);
  const filtered = isFiltered(values);
  const key = JSON.stringify(queryOf(values));

  useEffect(() => {
    if (!filtered) return () => {};
    let current = true;
    const load = async (): Promise<void> => {
      const answer = await client.call("decisions", {
        query: queryOf(values),
      });
      if (!current) return;
      setRead(before => ({
        key,
        rows: answer.ok ? answer.data : (before?.rows ?? null),
        error: answer.ok ? null : answer.error,
      }));
    };
    void load();
    // A decision opening or closing changes the stream's list: read again.
    const stop = decisions.subscribe(() => {
      void load();
    });
    return () => {
      current = false;
      stop();
    };
  }, [client, decisions, filtered, key, values]);

  const answered = read !== null && read.key === key;
  return {
    /** What the list shows; null until a filtered list has come. */
    rows: filtered ? (read?.rows ?? null) : open,
    /** A filtered read is in flight. */
    busy: filtered && !answered,
    /** The server's refusal of the filter, if it refused. */
    error: filtered && answered ? read.error : null,
  };
};

/** Says aloud how the newest settled decision ended, once. */
export const useSettledAnnounced = (
  settled: readonly DecisionRecord[],
): void => {
  const workspace = use(WorkspaceContext);
  const told = useRef(settled[0]?.id);
  useEffect(() => {
    const latest = settled[0];
    if (latest === undefined || latest.id === told.current) return;
    told.current = latest.id;
    workspace?.announce(`${latest.question} ${endingOf(latest)}`);
  }, [settled, workspace]);
};
