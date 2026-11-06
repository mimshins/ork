/**
 * @file The Feedback panel's tools and what its list card says: the status and
 *   about filters with how many each holds, how many items they leave, Reload
 *   with its CLI twin, and the list's states, from the first read to a failed
 *   one, an empty store and a filter that leaves nothing.
 */

import type { FeedbackItem } from "@krapht/ork-server/client";

import { EmptyState } from "../components/bits.tsx";
import { Button } from "../components/button.tsx";
import { CodeText } from "../components/code-text.tsx";
import { IconAlert } from "../components/icons.tsx";
import { Select } from "../components/select.tsx";
import {
  ABOUT_OPTIONS,
  emptyWords,
  type FeedbackFilter,
  itemsWords,
  statusOptions,
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
  onFilter: (next: FeedbackFilter) => void;
  onReload: () => void;
};

export const FeedbackTools = ({
  filter,
  items,
  count,
  updating,
  failed,
  onFilter,
  onReload,
}: ToolsProps) => (
  <div className={styles["tools"]}>
    <Select
      label="Status"
      onChange={status => {
        onFilter({ ...filter, status });
      }}
      options={statusOptions(items ?? [])}
      value={filter.status}
    />
    <Select
      label="About"
      onChange={about => {
        onFilter({ ...filter, about });
      }}
      options={ABOUT_OPTIONS}
      value={filter.about}
    />
    <div className={styles["toolsEnd"]}>
      {items === null ? null : (
        <span className={styles["count"]}>{itemsWords(count)}</span>
      )}
      {updating ? <span className={styles["updating"]}>Updating…</span> : null}
      <Button
        cli={
          filter.status === "all" || filter.status === "dismissed"
            ? "ork feedback list --all"
            : "ork feedback list"
        }
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
  /** Whether there is any feedback at all. */
  anything: boolean;
  filter: FeedbackFilter;
}) => {
  if (!anything) {
    return (
      <EmptyState title="No feedback yet.">
        {
          "What gets in your runs' way lands here: Ork's own signals, the agents' reports and your notes. In a terminal: "
        }
        <code>ork feedback list</code>
      </EmptyState>
    );
  }
  const { title, body } = emptyWords(filter);
  return <EmptyState title={title}>{body}</EmptyState>;
};
