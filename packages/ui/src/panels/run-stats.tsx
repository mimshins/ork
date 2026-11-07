/**
 * @file The figures in the Monitor's stat strip: what a run has spent against
 *   its budget, how many nodes are done (and, once it ends, how many it skipped
 *   and which failures it handled) and how long it has taken. The value is
 *   always in words, so the blocks are only there to be seen at a glance.
 */

import { MeterBlocks } from "../components/meter.tsx";
import { formatCost, formatElapsed, type NodeFacts } from "../graph/facts.ts";
import { doneCount, leftOut } from "./node-table.ts";
import type { RunView } from "./use-run-monitor.ts";

import styles from "./monitor.module.css";

const BUDGET_BLOCKS = 16;

export const RunStats = ({
  run,
  facts,
  budgetUsd,
  now,
}: {
  run: RunView;
  facts: ReadonlyMap<string, NodeFacts>;
  budgetUsd: number | undefined;
  now: number;
}) => {
  const left = leftOut(run);
  return (
    <dl className={styles["stats"]}>
      <div className={styles["stat"]}>
        <dt className={styles["statName"]}>
          Spent
          {budgetUsd === undefined ? "" : ` · cap ${formatCost(budgetUsd, [])}`}
        </dt>
        <dd className={styles["statValue"]}>
          {formatCost(run.costUsd)}
          {budgetUsd === undefined ? null : (
            <MeterBlocks
              blocks={BUDGET_BLOCKS}
              max={budgetUsd}
              value={run.costUsd}
            />
          )}
        </dd>
      </div>
      <div className={styles["stat"]}>
        <dt className={styles["statName"]}>Nodes</dt>
        <dd className={styles["statValue"]}>
          {doneCount([...facts.values()].map(({ status }) => status))}
          {left === null ? null : ` · ${left}`}
        </dd>
      </div>
      <div className={styles["stat"]}>
        <dt className={styles["statName"]}>Elapsed</dt>
        <dd className={styles["statValue"]}>
          {formatElapsed(
            (run.finishedAt === undefined ? now : Date.parse(run.finishedAt)) -
              Date.parse(run.startedAt),
          )}
        </dd>
      </div>
    </dl>
  );
};
