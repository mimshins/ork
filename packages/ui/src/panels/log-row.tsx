/**
 * @file One event in the Logs panel: its time, node, type and a line in words,
 *   on a button that opens the whole event. A row renders again only when its
 *   own state changes, so a busy run costs only the rows it adds.
 */

import type { StoredEvent } from "@krapht/ork-server/client";
import { memo } from "react";

import { lineOf, nodeOf, timeOf } from "./logs-model.ts";

import styles from "./logs.module.css";

export type LogRowProps = {
  stored: StoredEvent;
  open: boolean;
  /** The one row of the list that Tab reaches. */
  tabbable: boolean;
  onToggle: (seq: number) => void;
};

export const LogRow = memo(
  ({ stored, open, tabbable, onToggle }: LogRowProps) => {
    const { seq, at, event } = stored;
    return (
      <li className={styles["item"]}>
        <button
          aria-expanded={open}
          className={styles["row"]}
          data-log-row={seq}
          onClick={() => {
            onToggle(seq);
          }}
          tabIndex={tabbable ? 0 : -1}
          type="button"
        >
          <span className={styles["time"]}>{timeOf(at)}</span>
          <span className={styles["node"]}>{nodeOf(event) ?? "run"}</span>
          <span className={styles["type"]}>{event.type}</span>
          <span className={styles["line"]}>{lineOf(event)}</span>
        </button>
        {open ? (
          <pre className={styles["detail"]}>
            {JSON.stringify(event, null, 2)}
          </pre>
        ) : null}
      </li>
    );
  },
);
LogRow.displayName = "LogRow";
