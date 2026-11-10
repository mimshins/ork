/**
 * @file The run summary: under the Monitor's stat strip, a line for each node
 *   that did not end well, when the run stopped without succeeding, so the
 *   reason is there without opening the Logs panel. A line picks its node,
 *   which opens its strip and filters the Logs. Three show; the rest are one
 *   button away. A run that is running, paused or succeeded shows nothing.
 */

import { useState } from "react";

import { Button } from "../components/button.tsx";
import { CodeText } from "../components/code-text.tsx";
import { EndBadge } from "../components/end-badge.tsx";
import { rowsOf } from "./monitor-model.ts";
import type { RunView } from "./use-run-monitor.ts";

import styles from "./run-ends.module.css";

/** How many show before "Show N more". */
const SHOWN = 3;

/** The run statuses that mean it stopped without succeeding. */
const STOPPED: ReadonlySet<RunView["live"]> = new Set([
  "failed",
  "crashed",
  "budget_exhausted",
  "quota_exhausted",
  "timed_out",
  "interrupted",
]);

export const RunEnds = ({
  run,
  roots,
  onSelect,
}: {
  run: RunView;
  roots: Parameters<typeof rowsOf>[0];
  onSelect: (node: string) => void;
}) => {
  const [all, setAll] = useState(false);
  // In the order the nodes ended; a stable sort keeps the table's order for ties.
  const ended = rowsOf(roots)
    .flatMap(({ node }) =>
      node.end === undefined || node.end.actor === null
        ? []
        : [{ id: node.id, end: node.end, at: node.finishedAt ?? "" }],
    )
    .toSorted((a, b) => a.at.localeCompare(b.at));
  if (!STOPPED.has(run.live) || ended.length === 0) return null;
  const rest = ended.length - SHOWN;
  return (
    <section
      aria-label="Why the run stopped"
      className={styles["ends"]}
    >
      <ul className={styles["list"]}>
        {(all ? ended : ended.slice(0, SHOWN)).map(({ id, end }) => (
          <li key={id}>
            <button
              aria-label={`Select ${id}: ${end.label}${end.transient ? ", may pass" : ""}, ${end.message}`}
              className={styles["row"]}
              onClick={() => {
                onSelect(id);
              }}
              type="button"
            >
              <EndBadge end={end} />
              <span className={styles["id"]}>{id}</span>
              <span>
                <CodeText text={end.message} />
              </span>
            </button>
          </li>
        ))}
      </ul>
      {rest <= 0 ? null : (
        <Button
          aria-expanded={all}
          onClick={() => {
            setAll(shown => !shown);
          }}
          variant="ghost"
        >
          {all ? "Show fewer" : `Show ${String(rest)} more`}
        </Button>
      )}
    </section>
  );
};
