/**
 * @file What the Decisions panel says around its list: the one notice for when
 *   `ork ui` cannot be reached, and the empty state (nothing waits, or the
 *   filter bar's filter hides what does). The filter itself is the shared bar
 *   (components/filter-bar.tsx); it narrows the panel only: the badge,
 *   notifications and `ork decide` still count every open decision.
 */

import { useValue } from "react-containerized-state";

import { EmptyState } from "../components/bits.tsx";
import { CodeText } from "../components/code-text.tsx";
import { type FilterValues, isFiltered } from "../components/filter-model.ts";
import { FilterEmpty } from "../components/filter-notes.tsx";
import { IconAlert } from "../components/icons.tsx";
import { isUnreachable } from "../state/app-state.ts";
import { useAppState } from "../state/context.tsx";

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

/**
 * A read that failed for a reason other than a refused value: said once under
 * the bar, while the last rows stay shown. A live region, as the bar's alert.
 */
export const ReadFailed = ({ error }: { error: string }) => (
  <p
    className={styles["readFailed"]}
    data-read-failed=""
    role="alert"
  >
    <IconAlert aria-hidden="true" />
    <span>
      <CodeText text={`Could not read decisions: ${error}`} />
    </span>
  </p>
);

/** What shows when no card does: nothing waits, or the filter hides what does. */
export const DecisionsEmpty = ({
  values,
  onClear,
}: {
  values: FilterValues;
  onClear: () => void;
}) =>
  isFiltered(values) ? (
    <FilterEmpty
      list="decisions"
      onClear={onClear}
      values={values}
    />
  ) : (
    <EmptyState
      cli="ork decide"
      title="No decisions waiting."
    >
      Questions from your runs land here. In a terminal:
    </EmptyState>
  );
