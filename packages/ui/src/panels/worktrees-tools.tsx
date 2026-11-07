/**
 * @file The Worktrees panel's tools and what it says with nothing to list: the
 *   project filter, how many worktrees and branches it leaves, Clean merged…
 *   (disabled with its reason when nothing in scope is merged) and Reload, each
 *   with its CLI twin; a failed read; and the empty states, from no projects to
 *   a project with nothing left.
 */

import type { WorktreeRow } from "@krapht/ork-server/client";
import type { RefObject } from "react";

import { EmptyState } from "../components/bits.tsx";
import { Button } from "../components/button.tsx";
import { CodeText } from "../components/code-text.tsx";
import { CopyCommand } from "../components/copy-command.tsx";
import { IconAlert } from "../components/icons.tsx";
import { type Option, Select } from "../components/select.tsx";
import { countWords } from "./worktrees-model.ts";

import styles from "./worktrees.module.css";

export type ToolsProps = {
  filter: string;
  options: readonly Option[];
  /** What the filter leaves; null before the first answer. */
  items: readonly WorktreeRow[] | null;
  updating: boolean;
  /** Why Clean merged… can't be pressed, if it can't. */
  cleanBlocked: string | null;
  cleanButton: RefObject<HTMLButtonElement | null>;
  onFilter: (next: string) => void;
  onClean: () => void;
  onReload: () => void;
};

export const WorktreesTools = ({
  filter,
  options,
  items,
  updating,
  cleanBlocked,
  cleanButton,
  onFilter,
  onClean,
  onReload,
}: ToolsProps) => {
  return (
    <div className={styles["tools"]}>
      <Select
        label="Project"
        onChange={onFilter}
        options={options}
        value={filter}
      />
      <div className={styles["toolsEnd"]}>
        {items === null ? null : (
          <span className={styles["count"]}>{countWords(items)}</span>
        )}
        {/* A polite status, always there, so the change is heard. */}
        <output className={styles["count"]}>
          {updating ? "Updating…" : ""}
        </output>
        <Button
          aria-label={
            cleanBlocked === null ? undefined : `Clean merged…: ${cleanBlocked}`
          }
          cli="ork worktrees clean"
          disabled={cleanBlocked !== null}
          focusableWhenDisabled
          onClick={onClean}
          ref={cleanButton}
          tip={
            cleanBlocked === null ? undefined : `Clean merged…: ${cleanBlocked}`
          }
        >
          Clean merged…
        </Button>
        <Button
          cli="ork worktrees"
          onClick={onReload}
          tip="In the project's folder."
          variant="ghost"
        >
          Reload
        </Button>
      </div>
    </div>
  );
};

/** A read that failed: said once, above whatever the panel still shows. */
export const ReadFailed = ({ error }: { error: string }) => (
  <p
    className={styles["alert"]}
    role="alert"
  >
    <span className={styles["alertIcon"]}>
      <IconAlert />
    </span>
    <span>
      <CodeText text={`Could not read worktrees: ${error}`} />
    </span>
  </p>
);

/** What the panel says with nothing to list, and the next step. */
export const NoWorktrees = ({
  projects,
  one,
}: {
  /** How many projects Ork knows. */
  projects: number;
  /** The filter's project, when it keeps one. */
  one: string | null;
}) => {
  if (projects === 0) {
    return (
      <EmptyState
        cli="ork register <path>"
        focusable
        title="No projects registered yet."
      >
        <p>In a repository:</p>
        <CopyCommand command="ork init" />
        <p>Or from outside it:</p>
      </EmptyState>
    );
  }
  if (one !== null) {
    return (
      <EmptyState
        focusable
        title={`No Ork worktrees or branches in ${one}.`}
      >
        Project: All projects shows every project&apos;s.
      </EmptyState>
    );
  }
  return (
    <EmptyState
      cli="ork worktrees"
      focusable
      title="No Ork worktrees or branches."
    >
      <CodeText text="A run with `worktree` nodes leaves a worktree and an `ork/` branch for each; they wait here until you remove them. In a terminal, in a project's folder:" />
    </EmptyState>
  );
};
