/**
 * @file The Decisions panel's filter bar: a workflow and a run, each with the
 *   open decisions it has, and a count line (said aloud when it changes) of how
 *   many show and how many the filter hides. It narrows the panel only: the
 *   badge, notifications and `ork decide` still count every open decision. Here
 *   too is the one notice for when `ork ui` cannot be reached.
 */

import { useValue } from "react-containerized-state";

import { EmptyState } from "../components/bits.tsx";
import { Button } from "../components/button.tsx";
import { CodeText } from "../components/code-text.tsx";
import { IconAlert } from "../components/icons.tsx";
import { Select } from "../components/select.tsx";
import { isUnreachable } from "../state/app-state.ts";
import { useAppState } from "../state/context.tsx";
import {
  ALL_VALUE,
  countLine,
  type DecisionFilter,
  type FilterView,
  isFiltered,
  listCommand,
} from "./decisions-model.ts";

import styles from "./decisions.module.css";

/** Whether `ork ui` cannot be reached now, so no answer can be sent. */
export const useUnreachable = (): boolean =>
  isUnreachable(useValue(useAppState().connection));

/**
 * One notice for the panel, not a live region: the status bar already says the
 * reason aloud.
 */
export const UnreachableNotice = () => (
  <p
    className={styles["unreachable"]}
    data-unreachable-notice=""
  >
    <IconAlert aria-hidden="true" />
    <span>
      <CodeText text="Cannot answer here: `ork ui` is not reachable. Answer from a terminal with the command under each option." />
    </span>
  </p>
);

export const DecisionsFilter = ({
  view,
  open,
  onChange,
}: {
  view: FilterView;
  /** How many decisions are open, whatever the filter. */
  open: number;
  onChange: (filter: DecisionFilter) => void;
}) => {
  const { workflow, run } = view.active;
  return (
    <div className={styles["filter"]}>
      <div className={styles["filterFields"]}>
        <Select
          label="Workflow"
          onChange={value => {
            onChange(value === ALL_VALUE ? {} : { workflow: value });
          }}
          options={view.workflows}
          value={workflow ?? ALL_VALUE}
        />
        <Select
          label="Run"
          onChange={value => {
            onChange({
              ...(workflow === undefined ? {} : { workflow }),
              ...(value === ALL_VALUE ? {} : { run: value }),
            });
          }}
          options={view.runs}
          value={run ?? ALL_VALUE}
        />
      </div>
      <div className={styles["counts"]}>
        <output>{countLine(open, view.shown.length)}</output>
        {isFiltered(view.active) ? (
          <Button
            onClick={() => {
              onChange({});
            }}
            variant="ghost"
          >
            Clear filter
          </Button>
        ) : null}
      </div>
    </div>
  );
};

/** What shows when no card does: nothing waits, or the filter hides what does. */
export const DecisionsEmpty = ({
  filter,
  open,
  onClear,
}: {
  filter: DecisionFilter;
  /** How many decisions are open, whatever the filter. */
  open: number;
  onClear: () => void;
}) =>
  open === 0 ? (
    <EmptyState
      cli="ork decide"
      title="No decisions waiting."
    >
      Questions from your runs land here. In a terminal:
    </EmptyState>
  ) : (
    <EmptyState
      cli={listCommand(filter)}
      title="No decisions match the filter."
    >
      <p>
        {open === 1 ? "1 open decision is" : `${open} open decisions are`}{" "}
        hidden by it. Clear the filter to see {open === 1 ? "it" : "them"}.
      </p>
      <Button
        onClick={onClear}
        variant="ghost"
      >
        Clear filter
      </Button>
    </EmptyState>
  );
