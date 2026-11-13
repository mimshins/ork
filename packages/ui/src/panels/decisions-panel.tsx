/**
 * @file The Decisions panel: every open decision across runs, narrowed by a
 *   filter bar whose values the viewer's browser keeps, and below them the ones
 *   that have settled while it watched, with who answered and what they said.
 *   When the card holding the focus goes, the focus moves to the next one
 *   rather than out of the panel, and how it ended is said aloud.
 */

import { useCallback, useMemo } from "react";
import { useValue } from "react-containerized-state";

import { useAppState } from "../state/context.tsx";
import { DecisionCard } from "./decision-card.tsx";
import { DecisionsBar } from "./decisions-bar.tsx";
import {
  DecisionsEmpty,
  UnreachableNotice,
  useUnreachable,
} from "./decisions-filter.tsx";
import { DecisionsSettled } from "./decisions-settled.tsx";
import {
  useDecisionFilter,
  useDecisionsRead,
  useProjectSuggestions,
  useSettledAnnounced,
} from "./use-decisions.ts";
import { useKeptFocus } from "./use-kept-focus.ts";

import styles from "./decisions.module.css";

const NO_VALUES = {};

export const DecisionsPanel = () => {
  const state = useAppState();
  const decisions = useValue(state.decisions);
  const settled = useValue(state.settledDecisions);
  const runs = useValue(state.runs);
  const unreachable = useUnreachable();
  const filter = useDecisionFilter();
  const open = useMemo(() => decisions ?? [], [decisions]);
  const workflowOf = useCallback(
    (run: string): string | undefined =>
      runs?.find(({ id }) => id === run)?.workflow,
    [runs],
  );
  const projectSuggestions = useProjectSuggestions(open);
  const read = useDecisionsRead(filter.values, open);
  const shown = read.rows;
  const { panel, onFocus } = useKeptFocus(
    shown.map(({ id }) => id).join("\n"),
    "[data-decision]",
  );
  useSettledAnnounced(settled);

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
      <DecisionsBar
        onChange={filter.set}
        open={open}
        projects={projectSuggestions}
        read={read}
        values={filter.values}
        workflowOf={workflowOf}
      />
      {shown.length === 0 ? (
        <DecisionsEmpty
          onClear={() => {
            filter.set({});
          }}
          values={read.answered ? filter.values : NO_VALUES}
        />
      ) : (
        <div className={styles["list"]}>
          {unreachable ? <UnreachableNotice /> : null}
          {shown.map(decision => (
            <DecisionCard
              decision={decision}
              key={decision.id}
              onAnswer={state.answerDecision}
              onOpenRun={(run, node) => {
                state.selectRun(run);
                state.selectNode(node);
              }}
              unreachable={unreachable}
              workflow={workflowOf(decision.runId)}
            />
          ))}
        </div>
      )}
      <DecisionsSettled settled={settled} />
    </div>
  );
};
