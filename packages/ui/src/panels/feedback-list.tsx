/**
 * @file The Feedback panel's list: one row per item, most recently seen first,
 *   as `ork feedback list`. A row is its title and status, then its id, how
 *   often it was seen, what it's about, and when it was last seen. Its name is
 *   what it shows, in order, with the words only a screen reader needs ("3
 *   times", "last seen") and a pause between the parts, so every word seen is
 *   in it (WCAG 2.5.3). The list is one tab stop, and the arrow keys move
 *   through it. A row re-renders only when its own item changes, since an item
 *   that didn't keeps its object.
 */

import type { FeedbackItem } from "@krapht/ork-server/client";
import { type KeyboardEvent, memo } from "react";

import { ItemStatusBadge } from "../components/status-badge.tsx";
import { Unseen } from "../components/unseen.tsx";
import { short, timesWords } from "./feedback-model.ts";
import { timeOf } from "./run-row.tsx";

import styles from "./feedback.module.css";

/** Moves focus through the list; choosing stays with Enter, Space or a click. */
const moveFocus = (event: KeyboardEvent<HTMLUListElement>): void => {
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
  item: FeedbackItem;
  chosen: boolean;
  tabStop: boolean;
  onChoose: (id: string) => void;
};

export const FeedbackRow = memo(
  ({ item, chosen, tabStop, onChoose }: RowProps) => (
    <li>
      <button
        aria-current={chosen ? "true" : undefined}
        className={styles["row"]}
        data-item={item.id}
        onClick={() => {
          onChoose(item.id);
        }}
        tabIndex={tabStop ? 0 : -1}
        type="button"
      >
        <span className={styles["rowTop"]}>
          <span className={styles["rowTitle"]}>{item.title}</span>
          <Pause />
          <ItemStatusBadge status={item.status} />
        </span>
        <Pause />
        <span className={styles["rowMeta"]}>
          <span>{short(item.id)}</span>
          <Pause />
          <span>
            <span aria-hidden="true">{`${String(item.count)}×`}</span>
            <Unseen>{timesWords(item.count)}</Unseen>
          </span>
          <Pause />
          <span>{`${item.target} · ${item.kind}`}</span>
          {item.severity === "high" ? (
            <>
              <Pause />
              <span className={styles["high"]}>high</span>
            </>
          ) : null}
          {item.merged.length === 0 ? null : (
            <>
              <Pause />
              <span>{`+${String(item.merged.length)} merged`}</span>
            </>
          )}
          <Pause />
          <span>
            <Unseen>last seen </Unseen>
            <time dateTime={item.lastSeen}>{timeOf(item.lastSeen)}</time>
          </span>
        </span>
      </button>
    </li>
  ),
);
FeedbackRow.displayName = "FeedbackRow";

export const FeedbackList = ({
  items,
  chosen,
  onChoose,
}: {
  items: readonly FeedbackItem[];
  chosen: string | null;
  onChoose: (id: string) => void;
}) => {
  const tabStop = items.some(({ id }) => id === chosen) ? chosen : items[0]?.id;
  return (
    // A list with its own keys; it stays a list to a screen reader.
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- the keys move focus between the buttons inside
    <ul
      aria-label="Feedback items"
      className={styles["list"]}
      onKeyDown={moveFocus}
      // WebKit drops a list's role when its markers are off.
      // oxlint-disable-next-line jsx-a11y/no-redundant-roles -- see above
      role="list"
    >
      {items.map(item => (
        <FeedbackRow
          chosen={item.id === chosen}
          item={item}
          key={item.id}
          onChoose={onChoose}
          tabStop={item.id === tabStop}
        />
      ))}
    </ul>
  );
};
