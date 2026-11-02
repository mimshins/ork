/**
 * @file The Runs panel: the newest runs, filtered by project, and the way to
 *   start one. Choosing a run selects it for the other panels. The list is one
 *   tab stop, and the arrow keys move through it.
 */

import type { RunView } from "@krapht/ork-server/client";
import { type KeyboardEvent, useEffect, useMemo } from "react";
import { useComputedValue, useValue } from "react-containerized-state";

import { Button } from "../components/button.tsx";
import { IconPlay } from "../components/icons.tsx";
import { type Option, Select } from "../components/select.tsx";
import type { AppState } from "../state/app-state.ts";
import { useAppState } from "../state/context.tsx";
import { NoRuns, RunRow } from "./run-row.tsx";

import styles from "./runs.module.css";

const ALL_PROJECTS = "all";

const baseName = (root: string): string => root.split("/").at(-1) ?? root;

/** A run's project may be unregistered by now, so runs add to the list. */
const projectOptions = (
  projects: readonly { id: string; root: string }[],
  runs: readonly RunView[],
): Option[] => {
  const known = new Map(projects.map(({ root, id }) => [root, id]));
  for (const { project } of runs) {
    if (!known.has(project)) known.set(project, baseName(project));
  }
  return [
    { value: ALL_PROJECTS, label: "All projects" },
    ...[...known].map(([value, label]) => ({ value, label })),
  ];
};

/** Moves focus through the list; choosing stays with Enter, Space or a click. */
const moveFocus = (event: KeyboardEvent<HTMLUListElement>): void => {
  const buttons = [...event.currentTarget.querySelectorAll("button")];
  const at = buttons.findIndex(button => button === document.activeElement);
  const last = buttons.length - 1;
  const targets: Record<string, number> = {
    ArrowDown: Math.min(at + 1, last),
    ArrowUp: Math.max(at - 1, 0),
    Home: 0,
    End: last,
  };
  const target = targets[event.key];
  if (target !== undefined) {
    event.preventDefault();
    buttons[target]?.focus();
  }
};

const useWaitingRuns = (state: AppState): ReadonlySet<string> =>
  useComputedValue(
    state.decisions,
    list => new Set((list ?? []).map(({ runId }) => runId)),
  );

const useProjectList = (state: AppState) => {
  const projects = useValue(state.projects.state);
  useEffect(() => {
    void state.projects.load();
  }, [state]);
  return projects.status === "ready" ? projects.data : [];
};

export const RunsPanel = () => {
  const state = useAppState();
  const runs = useValue(state.runs);
  const filter = useValue(state.runFilter);
  const selected = useComputedValue(state.selection, ({ run }) => run);
  const waiting = useWaitingRuns(state);
  const projects = useProjectList(state);
  const all = useMemo(() => runs ?? [], [runs]);
  const options = useMemo(() => projectOptions(projects, all), [projects, all]);
  const shown = useMemo(
    () =>
      filter === ALL_PROJECTS ? all : all.filter(run => run.project === filter),
    [all, filter],
  );
  const tabStop = shown.some(({ id }) => id === selected)
    ? selected
    : shown[0]?.id;
  return (
    <div className={styles["panel"]}>
      <div className={styles["tools"]}>
        <Select
          label="Project"
          onChange={value => {
            void state.runFilter.setValue(value);
          }}
          options={options}
          value={filter}
        />
        <Button
          cli="ork run <workflow>"
          onClick={() => {
            void state.runDialog.setValue(true);
          }}
          variant="primary"
        >
          <IconPlay />
          Run workflow
        </Button>
      </div>
      {runs === null ? (
        <p className={styles["note"]}>Reading runs…</p>
      ) : shown.length === 0 ? (
        <NoRuns filtered={filter !== ALL_PROJECTS} />
      ) : (
        // A list with its own keys; it stays a list to a screen reader.
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- the keys move focus between the buttons inside
        <ul
          aria-label="Runs"
          className={styles["list"]}
          onKeyDown={moveFocus}
        >
          {shown.map(run => (
            <RunRow
              key={run.id}
              onSelect={state.selectRun}
              run={run}
              selected={run.id === selected}
              tabStop={run.id === tabStop}
              waiting={waiting.has(run.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
};
