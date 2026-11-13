/**
 * @file The Follow-ups panel's tools and what its list card says: the shared
 *   filter bar (open by default) with the summary, Reload with its CLI twin,
 *   the note when pull requests can't be checked, and the list's states, from
 *   the first read to a failed one, an empty store and a filter that leaves
 *   nothing.
 */

import { Button } from "../components/button.tsx";
import { CodeText } from "../components/code-text.tsx";
import { CopyCommand } from "../components/copy-command.tsx";
import { FilterBar } from "../components/filter-bar.tsx";
import type { FilterValues } from "../components/filter-model.ts";
import { IconAlert } from "../components/icons.tsx";
import type { FollowUpRow, FollowUpsRead } from "../state/follow-ups.ts";
import { checkerWords } from "./followups-acts.ts";
import { forSuggestions, summaryOf } from "./followups-model.ts";

import styles from "./followups.module.css";

/** How many projects have a follow-up in `rows`. */
export const projectsWithRows = (rows: readonly FollowUpRow[]): string[] => [
  ...new Set(rows.map(f => f.projectId)),
];

/** The follow-ups list's default for `status`, in the bar's words. */
const DEFAULTS = { status: "open" };

export type ToolsProps = {
  filter: FilterValues;
  /** Everything read; null before the first answer. */
  read: FollowUpsRead | null;
  updating: boolean;
  failed: boolean;
  /** The server's refusal of the filter, if it refused. */
  refusal: { message: string; field: string } | null;
  onFilter: (next: FilterValues) => void;
  onReload: () => void;
};

export const FollowUpsTools = ({
  filter,
  read,
  updating,
  failed,
  refusal,
  onFilter,
  onReload,
}: ToolsProps) => {
  const rows = read?.rows ?? [];
  const projects = read?.projects ?? [];
  return (
    <>
      <div className={styles["tools"]}>
        <div className={styles["toolsBar"]}>
          <FilterBar
            busy={updating}
            defaults={DEFAULTS}
            error={refusal}
            list="follow-ups"
            onChange={onFilter}
            shown={read === null ? null : rows.length}
            suggestions={{
              for: forSuggestions(rows),
              project: projects.map(value => ({ value, label: value })),
            }}
            summary={read === null ? "" : summaryOf(rows)}
            values={filter}
          />
        </div>
        <div className={styles["toolsEnd"]}>
          <Button
            aria-label={
              failed ? "Try again: reload follow-ups" : "Reload follow-ups"
            }
            cli="ork follow-ups list"
            onClick={onReload}
            variant="ghost"
          >
            {failed ? "Try again" : "Reload"}
          </Button>
        </div>
      </div>
      {read === null || read.checker.available ? null : (
        <p className={styles["alert"]}>
          <span className={styles["lineIcon"]}>
            <IconAlert />
          </span>
          <span>
            <CodeText text={checkerWords(read.checker.errors)} />
          </span>
        </p>
      )}
      {read === null || read.checker.available ? null : (
        <CopyCommand command="gh auth login" />
      )}
    </>
  );
};

/** A read that failed: said once, above the list that stays, dimmed. */
export const ReadFailed = ({
  error,
  onRetry,
}: {
  error: string;
  onRetry: () => void;
}) => (
  <div
    className={styles["alert"]}
    data-tone="failed"
    role="alert"
  >
    <span className={styles["lineIcon"]}>
      <IconAlert />
    </span>
    <span>
      <CodeText
        text={`Couldn't read follow-ups: ${error}. Reload, or in a terminal:`}
      />{" "}
      <CopyCommand command="ork follow-ups list" />
      <Button
        onClick={onRetry}
        variant="ghost"
      >
        Try again
      </Button>
    </span>
  </div>
);
