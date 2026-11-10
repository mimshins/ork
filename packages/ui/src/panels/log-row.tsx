/**
 * @file One event in the Logs panel: its time, node, type and a line in words,
 *   on a button that opens the whole event. A row renders again only when its
 *   own state changes, so a busy run costs only the rows it adds. A node that
 *   ended badly shows its end kind as a badge and Ork's sentence in the line,
 *   and its whole story (`EndNote`, with the raw details closed) over the
 *   event's JSON when opened.
 */

import type { StoredEvent } from "@krapht/ork-server/client";
import { memo } from "react";

import { EndBadge } from "../components/end-badge.tsx";
import { EndNote } from "../components/end-note.tsx";
import { endedOf, endLineOf, lineOf, nodeOf, timeOf } from "./logs-model.ts";

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
    const ended = endedOf(event);
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
          <span className={styles["line"]}>
            {ended === undefined ? (
              lineOf(event)
            ) : (
              <>
                <EndBadge end={ended.end} /> {endLineOf(ended)}
              </>
            )}
          </span>
        </button>
        {open && ended !== undefined ? (
          <div className={styles["end"]}>
            <EndNote
              end={ended.end}
              node={ended.id}
              runId={stored.runId}
            />
          </div>
        ) : null}
        {open ? (
          <pre
            aria-label={`Event ${String(seq)} in full`}
            className={styles["detail"]}
            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- text that keeps its layout, with a name
            role="group"
            // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the keys scroll it
            tabIndex={0}
          >
            {JSON.stringify(event, null, 2)}
          </pre>
        ) : null}
      </li>
    );
  },
);
LogRow.displayName = "LogRow";
