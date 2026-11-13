/**
 * @file The Feedback panel's tools and what its list card says: the shared
 *   filter bar (not dismissed by default) with the About select beside it and
 *   the count, Reload with its CLI twin, and the list's states, from the first
 *   read to a failed one, an empty store and a filter that leaves nothing.
 */

import type { FeedbackItem } from "@krapht/ork-server/client";

import { EmptyState } from "../components/bits.tsx";
import { Button } from "../components/button.tsx";
import { CodeText } from "../components/code-text.tsx";
import { FilterBar, type FilterBarProps } from "../components/filter-bar.tsx";
import { IconAlert } from "../components/icons.tsx";
import { Select } from "../components/select.tsx";
import {
  ABOUT_OPTIONS,
  DEFAULTS,
  emptyWords,
  type FeedbackFilter,
  itemsWords,
  suggestionsOf,
} from "./feedback-model.ts";

import styles from "./feedback.module.css";

export type ToolsProps = {
  filter: FeedbackFilter;
  /** Everything read; null before the first answer. */
  items: readonly FeedbackItem[] | null;
  /** How many the filters leave. */
  count: number;
  updating: boolean;
  failed: boolean;
  /** The server's refusal of the filter, if it refused. */
  refusal: { message: string; field: string } | null;
  onValues: FilterBarProps["onChange"];
  onAbout: (about: string) => void;
  onReload: () => void;
};

export const FeedbackTools = ({
  filter,
  items,
  count,
  updating,
  failed,
  refusal,
  onValues,
  onAbout,
  onReload,
}: ToolsProps) => (
  <div className={styles["tools"]}>
    <div className={styles["toolsBar"]}>
      <FilterBar
        busy={updating}
        defaults={DEFAULTS}
        error={refusal}
        list="feedback"
        onChange={onValues}
        shown={items === null ? null : count}
        suggestions={suggestionsOf(items ?? [])}
        summary={items === null ? "" : itemsWords(count)}
        values={filter.values}
      />
    </div>
    <Select
      label="About"
      onChange={onAbout}
      options={ABOUT_OPTIONS}
      value={filter.about}
    />
    <div className={styles["toolsEnd"]}>
      <Button
        cli="ork feedback list"
        onClick={onReload}
        variant="ghost"
      >
        {failed ? "Try again" : "Reload"}
      </Button>
    </div>
  </div>
);

/** A read that failed: said once, above whatever the list still shows. */
export const ReadFailed = ({ error }: { error: string }) => (
  <p
    className={styles["alert"]}
    data-tone="failed"
    role="alert"
  >
    <span className={styles["lineIcon"]}>
      <IconAlert />
    </span>
    <span>
      <CodeText text={`Could not read feedback: ${error}`} />
    </span>
  </p>
);

/** What the list says with nothing to show, and the next step. */
export const NoItems = ({
  anything,
  filter,
}: {
  /** Whether the read has any feedback at all. */
  anything: boolean;
  filter: FeedbackFilter;
}) => {
  if (!anything) {
    return (
      <EmptyState
        cli="ork feedback list"
        title="No feedback yet."
      >
        {
          "What gets in your runs' way lands here: Ork's own signals, the agents' reports and your notes. In a terminal:"
        }
      </EmptyState>
    );
  }
  const { title, body } = emptyWords({ status: "open", about: filter.about });
  return <EmptyState title={title}>{body}</EmptyState>;
};
