/**
 * @file The Decisions panel's settled list: the decisions that left the open
 *   list while it watched, each with how it ended, who answered and what they
 *   said. Their text is shown as it was written, not as Markdown (a gap in
 *   specs/gaps.md).
 */

import type { DecisionRecord } from "@krapht/ork-server/client";

import { CodeText } from "../components/code-text.tsx";
import { endingOf, saidOf } from "./decisions-model.ts";

import styles from "./decisions.module.css";

export const DecisionsSettled = ({
  settled,
}: {
  settled: readonly DecisionRecord[];
}) =>
  settled.length === 0 ? null : (
    <section
      aria-label="Settled decisions"
      className={styles["settled"]}
    >
      <h3 className={styles["settledTitle"]}>Settled</h3>
      <ul className={styles["settledList"]}>
        {settled.map(decision => (
          <li key={decision.id}>
            <span className={styles["settledQuestion"]}>
              {decision.question}
            </span>
            <span className={styles["settledEnding"]}>
              <code>{decision.runId}</code> · <code>{decision.node}</code>.{" "}
              <CodeText text={endingOf(decision)} />
            </span>
            {saidOf(decision) === undefined ? null : (
              <span className={styles["settledNote"]}>{saidOf(decision)}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
