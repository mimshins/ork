/**
 * @file The Feedback panel's state: its filters (which outlive a change of
 *   layout), the list they leave, the chosen item and its detail, which of the
 *   two a narrow panel shows, and where the focus goes next. When a read no
 *   longer lists the chosen item, the choice follows it into the item it was
 *   merged into, or clears; the focus never falls to the page.
 */

import type { FeedbackItem } from "@krapht/ork-server/client";
import {
  type FocusEvent,
  type RefObject,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useValue } from "react-containerized-state";

import { useAppState } from "../state/context.tsx";
import { shownOf } from "../state/read.ts";
import { WorkspaceContext } from "../workspace/context.ts";
import {
  type FeedbackFilter,
  itemsWords,
  mergedInto,
  panelShows,
  short,
  shownItems,
} from "./feedback-model.ts";
import { type FocusTarget, useFeedbackActs } from "./use-feedback-acts.ts";
import {
  useFeedbackDetail,
  useFeedbackList,
  useNarrow,
} from "./use-feedback.ts";

/** What changes when the item does: a reason to read its detail again. */
const stampOf = (item: FeedbackItem | undefined): string =>
  item === undefined
    ? ""
    : [item.status, item.count, item.lastSeen, ...item.merged].join("|");

const SELECTORS = {
  heading: "[data-feedback-heading]",
  list: "[data-feedback-list]",
} as const;

const targetIn = (root: HTMLElement | null, target: FocusTarget) =>
  root?.querySelector<HTMLElement>(
    typeof target === "string"
      ? SELECTORS[target]
      : `[data-item="${target.row}"]`,
  ) ?? null;

/** Moves the focus once what it goes to is drawn. */
const useFocusSoon = (root: RefObject<HTMLDivElement | null>) => {
  const pending = useRef<FocusTarget | null>(null);
  const [, setAsked] = useState(0);
  useEffect(() => {
    const target = pending.current;
    if (target === null) return;
    const element = targetIn(root.current, target);
    if (element === null) return;
    pending.current = null;
    element.focus();
  });
  return useCallback((target: FocusTarget): void => {
    pending.current = target;
    setAsked(count => count + 1);
  }, []);
};

/** Whether the focus was in the panel last, which outlives what had it. */
const useHadFocus = () => {
  const had = useRef(false);
  return {
    had,
    onFocus: (): void => {
      had.current = true;
    },
    onBlur: (event: FocusEvent<HTMLDivElement>): void => {
      const next = event.relatedTarget;
      const left =
        next instanceof Node
          ? !event.currentTarget.contains(next)
          : event.target.isConnected;
      if (left) had.current = false;
    },
  };
};

export const useFeedbackPanel = () => {
  const state = useAppState();
  const workspace = use(WorkspaceContext);
  const filter = useValue(state.feedbackFilter);
  const { read, load } = useFeedbackList(state);
  const root = useRef<HTMLDivElement>(null);
  const narrow = useNarrow(root);
  const [chosen, setChosen] = useState<string | null>(null);
  const [showing, setShowing] = useState<"list" | "detail">("list");
  const all = shownOf(read)?.data ?? null;
  const items = useMemo(() => all ?? [], [all]);
  const shown = useMemo(() => shownItems(items, filter), [items, filter]);
  const item = shown.find(({ id }) => id === chosen);
  const detail = useFeedbackDetail(
    state.client,
    item?.id ?? null,
    stampOf(item),
  );
  const focus = useFocusSoon(root);
  const focusWatch = useHadFocus();
  const choose = useCallback((id: string | null): void => {
    setChosen(id);
    setShowing(id === null ? "list" : "detail");
  }, []);
  const acts = useFeedbackActs({
    state,
    workspace,
    filter,
    narrow,
    choose,
    focus,
    reloadDetail: detail.reload,
  });
  const { moving } = acts;

  useEffect(() => {
    if (chosen === null || all === null || moving.current) return;
    if (shown.some(({ id }) => id === chosen)) return;
    const into = mergedInto(items, chosen);
    if (into !== undefined && shown.some(({ id }) => id === into.id)) {
      setChosen(into.id);
      workspace?.announce(
        `${short(chosen)} was merged into ${short(into.id)}.`,
      );
      return;
    }
    // A narrow panel says it's gone, with the way back to the list.
    if (narrow) return;
    setChosen(null);
    const dropped = document.activeElement === document.body;
    if (dropped && focusWatch.had.current) focus("list");
    // The focus flag is a ref the panel owns: reading it never re-runs this.
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, [chosen, all, items, shown, narrow, workspace, focus, moving]);

  /** Back to the list, the focus on the chosen row if it's there. */
  const back = (): void => {
    setShowing("list");
    const there = chosen !== null && shown.some(({ id }) => id === chosen);
    focus(there ? { row: chosen } : "list");
  };

  return {
    root,
    narrow,
    read,
    all,
    items,
    shown,
    filter,
    chosen,
    item,
    detail,
    acts,
    focusWatch,
    showing: panelShows(narrow, showing, chosen),
    back,
    choose: (id: string): void => {
      choose(id);
      if (narrow) focus("heading");
    },
    setFilter: (next: FeedbackFilter): void => {
      void state.feedbackFilter.setValue(next);
      workspace?.announce(`${itemsWords(shownItems(items, next).length)}.`);
    },
    reload: (): void => {
      void load();
      detail.reload();
    },
  };
};
