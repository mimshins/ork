/**
 * @file What the Usage panel says when the report has no spend: the filter
 *   hides every row (the bar's empty state), nothing was spent yet, or the
 *   server refused the read.
 */

import type { LimitsReport } from "@krapht/ork-server/client";

import { EmptyState } from "../components/bits.tsx";
import { Button } from "../components/button.tsx";
import { CodeText } from "../components/code-text.tsx";
import { CopyCommand } from "../components/copy-command.tsx";
import { type FilterValues, isFiltered } from "../components/filter-model.ts";
import { FilterEmpty } from "../components/filter-notes.tsx";
import { UsageLimits } from "./usage-limits.tsx";
import { isAllTime } from "./usage-model.ts";

import styles from "./usage.module.css";

export const NothingSpent = ({
  period,
  limits,
  values,
  onClear,
}: {
  period: string;
  limits: LimitsReport;
  values: FilterValues;
  onClear: () => void;
}) =>
  isFiltered(values) ? (
    <FilterEmpty
      list="usage"
      onClear={onClear}
      values={values}
    />
  ) : (
    <>
      <UsageLimits limits={limits} />
      <EmptyState
        cli="ork run <workflow>"
        title={
          isAllTime(period)
            ? "Nothing spent yet."
            : "Nothing spent in this period."
        }
      >
        Claude sessions show here once they finish. Start one with Run workflow,
        or in a terminal:
      </EmptyState>
    </>
  );

export const Refused = ({
  error,
  command,
  retry,
}: {
  error: string;
  command: string;
  retry: () => void;
}) => (
  <div className={styles["section"]}>
    <p
      className={styles["refused"]}
      role="alert"
    >
      Cannot read usage: <CodeText text={error} />
    </p>
    <div className={styles["retry"]}>
      <Button onClick={retry}>Try again</Button>
    </div>
    <p className={styles["note"]}>On a terminal, the same report:</p>
    <CopyCommand command={command} />
  </div>
);
