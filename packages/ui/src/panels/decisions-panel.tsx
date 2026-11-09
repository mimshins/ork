/**
 * @file The Decisions panel: every open decision across runs, narrowed by a
 *   workflow and run filter that the viewer's browser keeps, and below them the
 *   ones that have settled while it watched, with who answered and what they
 *   said. When the card holding the focus goes, the focus moves to the next one
 *   rather than out of the panel, and how it ended is said aloud.
 */

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useValue } from "react-containerized-state";

import { useAppState } from "../state/context.tsx";
import { WorkspaceContext } from "../workspace/context.ts";
import { DecisionCard } from "./decision-card.tsx";
import {
  DecisionsEmpty,
  DecisionsFilter,
  UnreachableNotice,
  useUnreachable,
} from "./decisions-filter.tsx";
import {
  type DecisionFilter,
  endingOf,
  filterView,
  isFiltered,
  presentOnly,
} from "./decisions-model.ts";
import { DecisionsSettled } from "./decisions-settled.tsx";
import { useKeptFocus } from "./use-kept-focus.ts";

import styles from "./decisions.module.css";

export const DecisionsPanel = () => {
  const state = useAppState();
  const workspace = use(WorkspaceContext);
  const decisions = useValue(state.decisions);
  const settled = useValue(state.settledDecisions);
  const runs = useValue(state.runs);
  const unreachable = useUnreachable();
  const told = useRef(settled[0]?.id);
  const { value: preferences, update } = state.preferences;
  const saved = useValue(preferences).decisionFilter;
  const open = useMemo(() => decisions ?? [], [decisions]);
  const workflowOf = useCallback(
    (run: string): string | undefined =>
      runs?.find(({ id }) => id === run)?.workflow,
    [runs],
  );
  // A saved value no longer among the open decisions is dropped, so it never
  // silently filters a later one; nothing is dropped before the first list.
  // After it, a filter that leaves nothing stays, with its way to clear it.
  const arrived = decisions !== null && runs !== null;
  const [checked, setChecked] = useState(false);
  const view = filterView(
    open,
    !arrived || checked ? saved : presentOnly(open, saved, workflowOf),
    workflowOf,
  );
  const manyRuns = new Set(open.map(({ runId }) => runId)).size > 1;
  const { panel, onFocus } = useKeptFocus(
    view.shown.map(({ id }) => id).join("\n"),
    "[data-decision]",
  );
  const choose = (filter: DecisionFilter): void => {
    update({ decisionFilter: filter });
  };

  useEffect(() => {
    if (checked || !arrived) return;
    const present = presentOnly(open, saved, workflowOf);
    if (present.workflow !== saved.workflow || present.run !== saved.run) {
      update({ decisionFilter: present });
    }
    // oxlint-disable-next-line react/set-state-in-effect -- once, after the first list
    setChecked(true);
  }, [arrived, checked, open, saved, update, workflowOf]);

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
      {isFiltered(view.active) || manyRuns ? (
        <DecisionsFilter
          onChange={choose}
          open={open.length}
          view={view}
        />
      ) : null}
      {view.shown.length === 0 ? (
        <DecisionsEmpty
          filter={view.active}
          onClear={() => {
            choose({});
          }}
          open={open.length}
        />
      ) : (
        <div className={styles["list"]}>
          {unreachable ? <UnreachableNotice /> : null}
          {view.shown.map(decision => (
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
