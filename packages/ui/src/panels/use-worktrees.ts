/**
 * @file What the Worktrees panel reads and shows. No stream carries git's
 *   state, so the list is read when the panel shows, after every remove or
 *   clean, on Reload, and when the runs change while it shows (a run that
 *   starts or ends), at most every 5 s; a read asked for while one is in flight
 *   waits for it rather than doubling it. The project filter is the panel's
 *   own, for the page's life, and a change says the count aloud.
 */

import type { WorktreesProject } from "@krapht/ork-server/client";
import { use, useCallback, useEffect, useRef } from "react";
import { useValue } from "react-containerized-state";

import { useAppState } from "../state/context.tsx";
import { shownOf } from "../state/read.ts";
import { WorkspaceContext } from "../workspace/context.ts";
import { ALL_PROJECTS, projectOptions } from "./project-options.ts";
import { FOLLOW_MS } from "./use-feedback.ts";
import { countSaid } from "./worktrees-model.ts";

/** The projects a filter keeps, in the filter's name order. */
const shownIn = (
  projects: readonly WorktreesProject[],
  filter: string,
): WorktreesProject[] =>
  filter === ALL_PROJECTS
    ? [...projects]
    : projects.filter(project => project.root === filter);

/** A project under the name the filter gives it. */
const renamed = (
  project: WorktreesProject,
  name: string,
): WorktreesProject => ({ ...project, name });

export const useWorktrees = () => {
  const state = useAppState();
  const workspace = use(WorkspaceContext);
  const read = useValue(state.worktrees.state);
  const filter = useValue(state.worktreesFilter);
  const runs = useValue(state.runs);
  const projectsRead = useValue(state.projects.state);
  const lastRead = useRef(0);
  const inFlight = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seenRuns = useRef(runs);

  const load = useCallback((): Promise<void> => {
    if (inFlight.current !== null) return inFlight.current;
    lastRead.current = Date.now();
    const reading = state.worktrees.load().finally(() => {
      inFlight.current = null;
    });
    inFlight.current = reading;
    return reading;
  }, [state]);

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
  const shown = all === null ? null : shownIn(ordered, filter);

  return {
    read,
    all: all === null ? null : ordered,
    shown,
    filter,
    options,
    load,
    setFilter: (next: string): void => {
      void state.worktreesFilter.setValue(next);
      const scope = next === ALL_PROJECTS ? null : labelOfRoot(next);
      workspace?.announce(countSaid(shownIn(ordered, next), scope));
    },
  };
};

export type WorktreesView = ReturnType<typeof useWorktrees>;
