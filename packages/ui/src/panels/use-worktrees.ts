/**
 * @file What the Worktrees panel reads and shows. No stream carries git's
 *   state, so the list is read when the panel shows, after every remove or
 *   clean, on Reload, and when the runs change while it shows (a run that
 *   starts or ends), at most every 5 s; a read asked for while one is in flight
 *   waits for it rather than doubling it. The filter bar's values are the
 *   panel's own, for the page's life: the server applies them, and a change
 *   reads again.
 */

import type { WorktreesProject } from "@krapht/ork-server/client";
import { useCallback, useEffect, useRef } from "react";
import { useValue } from "react-containerized-state";

import {
  type FilterValues,
  filterQuery,
  refusalOf,
} from "../components/filter-model.ts";
import { useAppState } from "../state/context.tsx";
import { shownOf } from "../state/read.ts";
import { ALL_PROJECTS, projectOptions } from "./project-options.ts";
import { FOLLOW_MS } from "./use-feedback.ts";

/** A project under the name the filter gives it. */
const renamed = (
  project: WorktreesProject,
  name: string,
): WorktreesProject => ({ ...project, name });

export const useWorktrees = () => {
  const state = useAppState();
  const read = useValue(state.worktrees.state);
  const filter = useValue(state.worktreesFilter);
  const runs = useValue(state.runs);
  const projectsRead = useValue(state.projects.state);
  const lastRead = useRef(0);
  const inFlight = useRef<{ key: string; reading: Promise<void> } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seenRuns = useRef(runs);

  const key = JSON.stringify(filter);
  const load = useCallback((): Promise<void> => {
    // A read for other values is not the one asked for: it starts its own.
    if (inFlight.current?.key === key) return inFlight.current.reading;
    lastRead.current = Date.now();
    const reading = state.worktrees.load(filterQuery(filter)).finally(() => {
      if (inFlight.current?.reading === reading) inFlight.current = null;
    });
    inFlight.current = { key, reading };
    return reading;
  }, [state, filter, key]);

  useEffect(() => {
    void load();
    if (state.projects.state.getValue().status === "idle") {
      void state.projects.load();
    }
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [load, state]);

  useEffect(() => {
    if (seenRuns.current === runs) return;
    seenRuns.current = runs;
    if (timer.current !== null) return;
    const wait = Math.max(0, lastRead.current + FOLLOW_MS - Date.now());
    timer.current = setTimeout(() => {
      timer.current = null;
      void load();
    }, wait);
  }, [runs, load]);

  const all = shownOf(read)?.data.projects ?? null;
  const options = projectOptions(shownOf(projectsRead)?.data ?? [], [
    ...(runs ?? []),
    ...(all ?? []).map(p => ({ project: p.root })),
  ]);
  const labelOfRoot = (root: string): string =>
    options.find(option => option.value === root)?.label ?? root;
  const named = (all ?? []).map(project =>
    renamed(project, labelOfRoot(project.root)),
  );
  const ordered = options.flatMap(option =>
    named.filter(project => project.root === option.value),
  );
  const shown = all === null ? null : ordered;
  const registered = shownOf(projectsRead)?.data ?? [];
  /** What the bar suggests for `project`: a registered project by its id. */
  const projectSuggestions = options
    .filter(option => option.value !== ALL_PROJECTS)
    .map(option => ({
      value: registered.find(p => p.root === option.value)?.id ?? option.value,
      label: option.label,
    }));

  return {
    read,
    /** The server's refusal of the filter, which keeps the last list. */
    refusal:
      read.status === "failed" ? refusalOf("worktrees", read.error) : null,
    /** How many projects Ork knows, whatever the filter. */
    known: Math.max(registered.length, all?.length ?? 0),
    shown,
    filter,
    projectSuggestions,
    load,
    setFilter: (next: FilterValues): void => {
      void state.worktreesFilter.setValue(next);
    },
  };
};

export type WorktreesView = ReturnType<typeof useWorktrees>;
