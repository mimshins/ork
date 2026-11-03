/**
 * @file The Decisions panel: every open decision across runs, and below them
 *   the ones that have settled while it watched, with who answered. When the
 *   card holding the focus goes, the focus moves to the next one rather than
 *   out of the panel, and how it ended is said aloud.
 */

import { use, useEffect, useRef } from "react";
import { useValue } from "react-containerized-state";

import { EmptyState } from "../components/bits.tsx";
import { useAppState } from "../state/context.tsx";
import { WorkspaceContext } from "../workspace/context.ts";
import { DecisionCard } from "./decision-card.tsx";
import { endingOf } from "./decisions-model.ts";

import styles from "./decisions.module.css";

export const DecisionsPanel = () => {
  const state = useAppState();
  const workspace = use(WorkspaceContext);
  const decisions = useValue(state.decisions);
  const settled = useValue(state.settledDecisions);
  const runs = useValue(state.runs);
  const panel = useRef<HTMLDivElement>(null);
  /** Where in the list the focus last was. */
  const focusedAt = useRef<number | null>(null);
  const told = useRef(settled[0]?.id);
  const open = decisions ?? [];
  const openKey = open.map(({ id }) => id).join("\n");
  const lastKey = useRef(openKey);

  useEffect(() => {
    if (openKey === lastKey.current) return;
    lastKey.current = openKey;
    const at = focusedAt.current;
    if (at === null || document.activeElement !== document.body) return;
    const cards =
      panel.current?.querySelectorAll<HTMLElement>("[data-decision]");
    const next = cards?.[Math.min(at, (cards.length || 1) - 1)];
    (next ?? panel.current)?.focus();
  }, [openKey]);

  useEffect(() => {
    const latest = settled[0];
    if (latest === undefined || latest.id === told.current) return;
    told.current = latest.id;
    workspace?.announce(`${latest.question} ${endingOf(latest)}`);
  }, [settled, workspace]);

  return (
    <div
      className={styles["panel"]}
      onFocus={event => {
        const { target } = event;
        const card =
          target instanceof Element
            ? target.closest<HTMLElement>("[data-decision]")
            : null;
        focusedAt.current =
          card === null
            ? null
            : open.findIndex(({ id }) => card.dataset["decision"] === id);
      }}
      ref={panel}
      tabIndex={-1}
    >
      {open.length === 0 ? (
        <EmptyState title="No decisions waiting.">
          Questions from your runs land here. In a terminal:{" "}
          <code>ork decide</code>
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
                  {decision.runId} · {decision.node}. {endingOf(decision)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};
