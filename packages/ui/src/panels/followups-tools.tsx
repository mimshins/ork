/**
 * @file The Follow-ups panel's tools and what its list card says: the Status,
 *   For, Kind and, with more than one project, Project filters with how many
 *   each holds, the summary, Reload with its CLI twin, the note when pull
 *   requests can't be checked, and the list's states, from the first read to a
 *   failed one, an empty store and a filter that leaves nothing.
 */

import { Button } from "../components/button.tsx";
import { CodeText } from "../components/code-text.tsx";
import { CopyCommand } from "../components/copy-command.tsx";
import { IconAlert } from "../components/icons.tsx";
import { type Option, Select } from "../components/select.tsx";
import type { FollowUpRow, FollowUpsRead } from "../state/follow-ups.ts";
import { ALL_PROJECTS } from "../state/preferences.ts";
import { checkerWords } from "./followups-acts.ts";
import {
  type FollowUpsFilter,
  forOptions,
  kindOptions,
  shownRows,
  statusOptions,
  summaryOf,
} from "./followups-model.ts";

import styles from "./followups.module.css";

const projectOptions = (
  rows: readonly FollowUpRow[],
  projects: readonly string[],
  filter: FollowUpsFilter,
): Option[] => [
  {
    value: ALL_PROJECTS,
    label: `All projects (${String(shownRows(rows, { ...filter, project: ALL_PROJECTS }).length)})`,
  },
  ...projects.map(value => ({
    value,
    label: `${value} (${String(shownRows(rows, { ...filter, project: value }).length)})`,
  })),
];

/** How many projects have a follow-up: the Project filter shows from two. */
export const projectsWithRows = (rows: readonly FollowUpRow[]): string[] => [
  ...new Set(rows.map(f => f.projectId)),
];

export type ToolsProps = {
  filter: FollowUpsFilter;
  /** Everything read; null before the first answer. */
  read: FollowUpsRead | null;
  updating: boolean;
  failed: boolean;
  onFilter: (next: FollowUpsFilter) => void;
  onReload: () => void;
};

export const FollowUpsTools = ({
  filter,
  read,
  updating,
  failed,
  onFilter,
  onReload,
}: ToolsProps) => {
  const rows = read?.rows ?? [];
  const projects = projectsWithRows(rows);
  return (
    <>
      <div className={styles["tools"]}>
        <Select
          label="Status"
          onChange={status => {
            onFilter({ ...filter, status });
          }}
          options={statusOptions(rows, filter)}
          value={filter.status}
        />
        <Select
          label="For"
          onChange={next => {
            onFilter({ ...filter, for: next });
          }}
          options={forOptions(rows, filter)}
          value={filter.for}
        />
        <Select
          label="Kind"
          onChange={kind => {
            onFilter({ ...filter, kind });
          }}
          options={kindOptions(rows, filter)}
          value={filter.kind}
        />
        {projects.length > 1 ? (
          <Select
            label="Project"
            onChange={project => {
              onFilter({ ...filter, project });
            }}
            options={projectOptions(rows, projects, filter)}
            value={filter.project}
          />
        ) : null}
        <div className={styles["toolsEnd"]}>
          {read === null ? null : (
            <span className={styles["count"]}>{summaryOf(rows)}</span>
          )}
          {updating ? (
            <span className={styles["updating"]}>Updating…</span>
          ) : null}
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
