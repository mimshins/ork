/**
 * @file Tells the Context panel what the Builder shows. Selecting a card, even
 *   the one already selected, or opening a workflow, is a choice of what to
 *   show there; each new answer about the workflow asks the panel to plan
 *   again, so it follows the draft; closing the workflow leaves the panel with
 *   nothing. Nothing the Builder does by itself, such as clearing its selection
 *   after a discard, moves the panel.
 */

import type { BuilderView } from "@krapht/ork-server/client";
import { useCallback, useEffect, useRef } from "react";

import { useAppState } from "../state/context.tsx";
import type { Opened } from "./use-builder.ts";

/** Returns what to call when the person selects a card, or none. */
export const useBuilderContext = (
  opened: Opened | null,
  view: BuilderView | null,
): ((node: string | null) => void) => {
  const state = useAppState();
  const draft = useRef(false);
  draft.current = view?.draft ?? false;
  useEffect(() => {
    if (opened === null) {
      state.builderClosed();
      return;
    }
    state.chooseBuilderNode({
      project: opened.project,
      workflow: opened.name,
      node: null,
      draft: draft.current,
    });
  }, [state, opened]);
  useEffect(() => {
    if (opened !== null && view !== null) {
      state.builderChanged(opened.project, opened.name, view.draft);
    }
    // oxlint-disable-next-line react/exhaustive-deps -- each new view is a change; `opened` comes with it
  }, [state, view]);
  return useCallback(
    (node: string | null) => {
      if (opened === null) return;
      state.chooseBuilderNode({
        project: opened.project,
        workflow: opened.name,
        node,
        draft: draft.current,
      });
    },
    [state, opened],
  );
};
