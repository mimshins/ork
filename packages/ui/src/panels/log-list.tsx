/**
 * @file The Logs list: one tab stop, with the arrow keys, `Home` and `End`
 *   moving through its rows and `Enter` opening one. Rows the page is not
 *   showing cost little, since the browser skips laying them out.
 */

import type { StoredEvent } from "@krapht/ork-server/client";
import { type KeyboardEvent, type Ref, useCallback, useState } from "react";

import { EmptyState } from "../components/bits.tsx";
import { LogRow } from "./log-row.tsx";

import styles from "./logs.module.css";

export const LogList = ({
  shown,
  listRef,
  onScroll,
  label,
  reading,
}: {
  shown: readonly StoredEvent[];
  /** Nothing has been read yet. */
  reading: boolean;
  listRef: Ref<HTMLOListElement>;
  onScroll: () => void;
  label: string;
}) => {
  const [opened, setOpened] = useState<ReadonlySet<number>>(new Set());
  const [current, setCurrent] = useState<number | null>(null);
  const tabbable = shown.some(({ seq }) => seq === current)
    ? current
    : (shown.at(-1)?.seq ?? null);

  const toggle = useCallback((seq: number) => {
    setCurrent(seq);
    setOpened(known => {
      const next = new Set(known);
      if (!next.delete(seq)) next.add(seq);
      return next;
    });
  }, []);

  const onKey = (event: KeyboardEvent<HTMLOListElement>): void => {
    const rows = [
      ...event.currentTarget.querySelectorAll<HTMLElement>("[data-log-row]"),
    ];
    const here = rows.findIndex(row => row === event.target);
    if (here === -1) return;
    const targets: Readonly<Record<string, HTMLElement | undefined>> = {
      ArrowDown: rows[here + 1],
      ArrowUp: rows[here - 1],
      Home: rows[0],
      End: rows.at(-1),
    };
    if (!(event.key in targets)) return;
    event.preventDefault();
    const target = targets[event.key];
    if (target === undefined) return;
    setCurrent(Number(target.dataset["logRow"]));
    target.focus();
  };

  if (shown.length === 0) {
    return (
      <EmptyState title={reading ? "Reading the run…" : "No event matches."}>
        Only loaded events are filtered. Load older ones to look further.
      </EmptyState>
    );
  }
  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- the rows' keys, handled in one place
    <ol
      aria-label={label}
      className={styles["list"]}
      onKeyDown={onKey}
      onScroll={onScroll}
      ref={listRef}
    >
      {shown.map(stored => (
        <LogRow
          key={stored.seq}
          onToggle={toggle}
          open={opened.has(stored.seq)}
          stored={stored}
          tabbable={stored.seq === tabbable}
        />
      ))}
    </ol>
  );
};
