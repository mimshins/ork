/**
 * @file The Decisions panel's filter bar: the shared bar on the `decisions`
 *   list (specs/ui/design-filter-bar.md), suggesting the workflows and runs
 *   that have open decisions and saying how many are open while no filter is
 *   set. It narrows the panel only: the badge, notifications and `ork decide`
 *   still count every open decision.
 */

import type { DecisionRecord } from "@krapht/ork-server/client";

import { FilterBar } from "../components/filter-bar.tsx";
import { refusalOf, type FilterValues } from "../components/filter-model.ts";
import { openLine, suggestionsOf, type WorkflowOf } from "./decisions-model.ts";

import styles from "./decisions.module.css";

export const DecisionsBar = ({
  values,
  onChange,
  open,
  workflowOf,
  read,
}: {
  values: FilterValues;
  onChange: (next: FilterValues) => void;
  /** Every open decision, whatever the filter. */
  open: readonly DecisionRecord[];
  workflowOf: WorkflowOf;
  /** What the panel's read says of the filtered list. */
  read: {
    rows: readonly unknown[] | null;
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
      shown={read.rows === null ? null : read.rows.length}
      suggestions={suggestionsOf(open, workflowOf)}
      summary={openLine(open.length)}
      values={values}
    />
  </div>
);
