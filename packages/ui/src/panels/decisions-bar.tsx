/**
 * @file The Decisions panel's filter bar: the shared bar on the `decisions`
 *   list (specs/ui/design-filter-bar.md), suggesting the runs with open
 *   decisions, then the others it knows of, and their workflows, and saying how
 *   many are open while no filter is set. It narrows the panel only: the badge,
 *   notifications and `ork decide` still count every open decision.
 */

import type { DecisionRecord } from "@krapht/ork-server/client";

import { FilterBar } from "../components/filter-bar.tsx";
import type { Suggestion } from "../components/filter-input.tsx";
import { refusalOf, type FilterValues } from "../components/filter-model.ts";
import {
  type KnownRun,
  openLine,
  suggestionsOf,
  type WorkflowOf,
} from "./decisions-model.ts";

import styles from "./decisions.module.css";

export const DecisionsBar = ({
  values,
  onChange,
  open,
  workflowOf,
  projects,
  runs,
  read,
}: {
  values: FilterValues;
  onChange: (next: FilterValues) => void;
  /** Every open decision, whatever the filter. */
  open: readonly DecisionRecord[];
  workflowOf: WorkflowOf;
  /** The registered projects (and those of open decisions' runs), for Project. */
  projects: readonly Suggestion[];
  /** The runs the panel knows of, newest first: suggested after those asking. */
  runs: readonly KnownRun[];
  /** What the panel's read says of the filtered list. */
  read: {
    rows: readonly unknown[];
    /** Whether `rows` is an accepted answer, not the list before one. */
    answered: boolean;
    busy: boolean;
    error: string | null;
  };
}) => (
  <div className={styles["filter"]}>
    <FilterBar
      busy={read.busy}
      error={read.error === null ? null : refusalOf("decisions", read.error)}
      list="decisions"
      onChange={onChange}
      shown={read.answered ? read.rows.length : null}
      suggestions={suggestionsOf(open, workflowOf, projects, runs)}
      summary={openLine(open.length)}
      values={values}
    />
  </div>
);
