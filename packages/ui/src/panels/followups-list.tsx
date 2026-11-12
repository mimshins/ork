/**
 * @file The Follow-ups panel's list, grouped as `ork follow-ups` groups it: by
 *   due, then by who it is for, each group under a heading. A row is its title
 *   and status, then its id, kind, due word, ref and when it was added. Its
 *   name is what it shows, in order, with the words only a screen reader needs
 *   and a pause between the parts, so every word seen is in it (WCAG 2.5.3).
 *   The list is one tab stop and the arrow keys move through every group,
 *   skipping headings.
 */

import { type KeyboardEvent, memo } from "react";

import { FollowUpStatusBadge } from "../components/status-badge.tsx";
import { Unseen } from "../components/unseen.tsx";
import type { FollowUpRow } from "../state/follow-ups.ts";
import {
  dayOf,
  dueWord,
  type Group,
  groupRows,
  isSent,
  orderedRows,
  refWords,
  short,
  whyDue,
} from "./followups-model.ts";
import { timeOf } from "./run-row.tsx";

import styles from "./followups.module.css";

/** Moves focus across every group; choosing stays with Enter, Space or a click. */
const moveFocus = (event: KeyboardEvent<HTMLElement>): void => {
  const rows = [...event.currentTarget.querySelectorAll("button")];
  const at = rows.findIndex(row => row === document.activeElement);
  const last = rows.length - 1;
  const targets: Record<string, number> = {
    ArrowDown: Math.min(at + 1, last),
    ArrowUp: Math.max(at - 1, 0),
    Home: 0,
    End: last,
  };
  const target = targets[event.key];
  if (target !== undefined) {
    event.preventDefault();
    rows[target]?.focus();
  }
};

/** A comma a screen reader pauses on, between parts the eye sees apart. */
const Pause = () => <Unseen>, </Unseen>;

type RowProps = {
  row: FollowUpRow;
  chosen: boolean;
  tabStop: boolean;
  /** Names the project first, when more than one shows. */
  showProject: boolean;
  /** The time the reasons are worked out at, so a row re-renders with it. */
  today: number;
  onChoose: (id: string) => void;
};

export const FollowUpRowButton = memo(
  ({ row, chosen, tabStop, showProject, today, onChoose }: RowProps) => {
    const why = whyDue(row, new Date(today));
    const closed = row.status === "done" || row.status === "dropped";
    return (
      <li>
        <button
          aria-current={chosen ? "true" : undefined}
          className={`${styles["row"] ?? ""} ${closed ? (styles["rowDone"] ?? "") : ""}`}
          data-follow-up={row.id}
          onClick={() => {
            onChoose(row.id);
          }}
          tabIndex={tabStop ? 0 : -1}
          type="button"
        >
          <span className={styles["rowTop"]}>
            <span className={styles["rowTitle"]}>{row.title}</span>
            <Pause />
            <FollowUpStatusBadge
              sent={isSent(row)}
              status={row.status}
            />
          </span>
          <Pause />
          <span className={styles["rowMeta"]}>
            {showProject ? (
              <>
                <span>{row.projectId}</span>
                <Pause />
              </>
            ) : null}
            <span>{short(row.id)}</span>
            <Pause />
            <Unseen>for {row.for}, </Unseen>
            <span>{row.kind}</span>
            <Pause />
            <span>{dueWord(row)}</span>
            {why === undefined ? null : (
              <>
                <Pause />
                <span>{why}</span>
              </>
            )}
            {row.ref === undefined ? null : (
              <>
                <Pause />
                <span>{refWords(row.ref)}</span>
              </>
            )}
            <Pause />
            <span>
              <Unseen>added </Unseen>
              <time dateTime={row.createdAt}>{timeOf(row.createdAt)}</time>
            </span>
          </span>
        </button>
      </li>
    );
  },
);
FollowUpRowButton.displayName = "FollowUpRowButton";

/** A group's caption: the words upper case, a date as the value it is. */
const Caption = ({ group, count }: { group: Group; count: number }) => (
  <h4 className={styles["groupCaption"]}>
    <span className={styles["captionValue"]}>{group.label}</span>
    {` · ${String(count)}`}
  </h4>
);

export const FollowUpsList = ({
  rows,
  chosen,
  showProject,
  today,
  onChoose,
}: {
  rows: readonly FollowUpRow[];
  chosen: string | null;
  showProject: boolean;
  today: number;
  onChoose: (id: string) => void;
}) => {
  const groups = groupRows(rows, dayOf(new Date(today)));
  const first = orderedRows(groups)[0]?.id;
  const tabStop = rows.some(f => f.id === chosen) ? chosen : first;
  return (
    // The keys move focus between the buttons inside; the headings and lists stay as they are.
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- see above
    <div
      className={styles["list"]}
      onKeyDown={moveFocus}
    >
      {groups.map(group => (
        <div
          className={styles["group"]}
          key={group.key}
        >
          <Caption
            count={group.groups.reduce((sum, g) => sum + g.rows.length, 0)}
            group={group}
          />
          {group.groups.map(inFor => (
            <div
              className={styles["group"]}
              key={inFor.for}
            >
              <p className={styles["forLine"]}>{inFor.for}</p>
              <ul
                aria-label={`${group.label}, for ${inFor.for}`}
                className={styles["list"]}
                // WebKit drops a list's role when its markers are off.
                // oxlint-disable-next-line jsx-a11y/no-redundant-roles -- see above
                role="list"
              >
                {inFor.rows.map(row => (
                  <FollowUpRowButton
                    chosen={row.id === chosen}
                    key={row.id}
                    onChoose={onChoose}
                    row={row}
                    showProject={showProject}
                    tabStop={row.id === tabStop}
                    today={today}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};
