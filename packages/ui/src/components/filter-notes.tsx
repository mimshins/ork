/**
 * @file What the list filter bar says besides its fields
 *   (specs/ui/design-filter-bar.md#states): the alert (an icon and Ork's own
 *   words), the note for fields that could not be read, and the empty state a
 *   panel shows when the filter hides every row.
 */

import type { ListName } from "@krapht/ork-server/client";

import { EmptyState } from "./bits.tsx";
import { Button } from "./button.tsx";
import { CodeText } from "./code-text.tsx";
import { CopyCommand } from "./copy-command.tsx";
import {
  type FilterValues,
  filterCommand,
  LIST_WORDS,
} from "./filter-model.ts";
import { IconAlert } from "./icons.tsx";

import styles from "./filter-bar.module.css";

/** The one alert: an icon and words, so no state rests on color. */
export const FilterAlert = ({ id, text }: { id?: string; text: string }) => (
  <p
    className={styles["alert"]}
    id={id}
    role="alert"
  >
    <IconAlert aria-hidden="true" />
    <span>
      <CodeText text={text} />
    </span>
  </p>
);

/** The fields could not be read: the list shows without filters. */
export const FieldsFailed = ({
  list,
  error,
  onRetry,
}: {
  list: ListName;
  error: string;
  onRetry: () => void;
}) => {
  const { help } = LIST_WORDS[list];
  return (
    <div className={styles["failed"]}>
      <FilterAlert
        text={`Couldn't read the filter fields: ${error}. The list shows without filters.`}
      />
      <div className={styles["actions"]}>
        <Button onClick={onRetry}>Try again</Button>
      </div>
      <CopyCommand
        command={help}
        label={`Copy command (${help})`}
      />
    </div>
  );
};

export type FilterEmptyProps = {
  list: ListName;
  values: FilterValues;
  onClear: () => void;
};

/**
 * What a panel shows when the filter hides every row. With no filter set the
 * panel shows its own empty state instead.
 */
export const FilterEmpty = ({ list, values, onClear }: FilterEmptyProps) => (
  <EmptyState
    cli={filterCommand(list, values)}
    title={`No ${LIST_WORDS[list].plural} match the filter.`}
  >
    <p>Clear the filter to see the default list.</p>
    <Button
      cli={LIST_WORDS[list].command}
      onClick={onClear}
      variant="ghost"
    >
      Clear filter
    </Button>
  </EmptyState>
);
