/**
 * @file The Runs panel: the newest runs, narrowed by the shared filter bar
 *   (specs/ui/design-filter-bar.md), and the way to start one. Unfiltered it
 *   shows the stream's runs; with a filter set it shows what `GET /api/runs`
 *   answers for it. Choosing a run selects it for the other panels. The list is
 *   one tab stop, and the arrow keys move through it.
 */

import { type KeyboardEvent, useMemo } from "react";
import { useComputedValue, useValue } from "react-containerized-state";

import { FilterBar } from "../components/filter-bar.tsx";
import { FilterEmpty } from "../components/filter-notes.tsx";
import { useAppState } from "../state/context.tsx";
import { ALL_PROJECTS, projectOptions } from "./project-options.ts";
import { NoRuns, RunRow, RunWorkflowButton } from "./run-row.tsx";
import { TriggersSection } from "./triggers-section.tsx";
import {
  useFilteredRuns,
  useProjectList,
  useWaitingRuns,
} from "./use-runs-panel.ts";

import styles from "./runs.module.css";

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

export const RunsPanel = () => {
  const state = useAppState();
  const runs = useValue(state.runs);
  const values = useValue(state.runFilter);
  const selected = useComputedValue(state.selection, ({ run }) => run);
  const waiting = useWaitingRuns(state);
  const projects = useProjectList(state);
  const answer = useFilteredRuns(state, values);
  const all = useMemo(() => runs ?? [], [runs]);
  const suggestions = useMemo(
    () =>
      projectOptions(projects, all).filter(
        option => option.value !== ALL_PROJECTS,
      ),
    [projects, all],
  );
  const { filtered } = answer;
  const shown = filtered ? answer.rows : runs;
  const rows = shown ?? [];
  const tabStop = rows.some(({ id }) => id === selected)
    ? selected
    : rows[0]?.id;
  return (
    <div className={styles["panel"]}>
      <div className={styles["tools"]}>
        <div className={styles["filter"]}>
          <FilterBar
            busy={answer.busy}
            error={answer.refused === null ? null : { message: answer.refused }}
            list="runs"
            onChange={next => {
              void state.runFilter.setValue(next);
            }}
            shown={answer.rows?.length ?? null}
            suggestions={{ project: suggestions }}
            values={values}
          />
        </div>
        <RunWorkflowButton
          onClick={() => {
            void state.runDialog.setValue(true);
          }}
        />
      </div>
      <div className={styles["main"]}>
        {answer.failed === null ? null : (
          <p
            className={styles["note"]}
            role="alert"
          >
            Cannot read runs: {answer.failed}
          </p>
        )}
        {shown === null ? (
          <p className={styles["note"]}>Reading runs…</p>
        ) : rows.length === 0 ? (
          filtered ? (
            <FilterEmpty
              list="runs"
              onClear={() => {
                void state.runFilter.setValue({});
              }}
              values={values}
            />
          ) : (
            <NoRuns />
          )
        ) : (
          // A list with its own keys; it stays a list to a screen reader.
          // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- the keys move focus between the buttons inside
          <ul
            aria-label="Runs"
            className={styles["list"]}
            onKeyDown={moveFocus}
          >
            {rows.map(run => (
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
      <TriggersSection />
    </div>
  );
};
