/**
 * @file The Decisions panel: every open decision across runs, and below them
 *   the ones that have settled while it watched, with who answered and what
 *   they said. When the card holding the focus goes, the focus moves to the
 *   next one rather than out of the panel, and how it ended is said aloud.
 */

import { use, useEffect, useRef } from "react";
import { useValue } from "react-containerized-state";

import { EmptyState } from "../components/bits.tsx";
import { CodeText } from "../components/code-text.tsx";
import { useAppState } from "../state/context.tsx";
import { WorkspaceContext } from "../workspace/context.ts";
import { DecisionCard } from "./decision-card.tsx";
import { endingOf, saidOf } from "./decisions-model.ts";
import { useKeptFocus } from "./use-kept-focus.ts";

import styles from "./decisions.module.css";

export const DecisionsPanel = () => {
  const state = useAppState();
  const workspace = use(WorkspaceContext);
  const decisions = useValue(state.decisions);
  const settled = useValue(state.settledDecisions);
  const runs = useValue(state.runs);
  const told = useRef(settled[0]?.id);
  const open = decisions ?? [];
  const { panel, onFocus } = useKeptFocus(
    open.map(({ id }) => id).join("\n"),
    "[data-decision]",
  );

  useEffect(() => {
    const latest = settled[0];
    if (latest === undefined || latest.id === told.current) return;
    told.current = latest.id;
    workspace?.announce(`${latest.question} ${endingOf(latest)}`);
  }, [settled, workspace]);

  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- notes where the focus is
    <div
      aria-label="Decisions"
      className={styles["panel"]}
      onFocus={onFocus}
      ref={panel}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- where the focus can land, not a landmark: the dock names the panel
      role="group"
      tabIndex={-1}
    >
      {open.length === 0 ? (
        <EmptyState
          cli="ork decide"
          title="No decisions waiting."
        >
          Questions from your runs land here. In a terminal:
        </EmptyState>
      ) : (
        <div className={styles["list"]}>
          {open.map(decision => (
            <DecisionCard
              decision={decision}
              key={decision.id}
              onAnswer={state.answerDecision}
              onOpenRun={(run, node) => {
                state.selectRun(run);
                state.selectNode(node);
              }}
              workflow={runs?.find(({ id }) => id === decision.runId)?.workflow}
            />
          ))}
        </div>
      )}
      {settled.length === 0 ? null : (
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
                  <span className={styles["settledNote"]}>
                    {saidOf(decision)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};
