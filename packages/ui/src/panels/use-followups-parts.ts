/**
 * @file Parts of the Follow-ups panel's state: moving the focus once what it
 *   goes to is drawn, one follow-up's detail (read when it is chosen and
 *   whenever it changes), and saying aloud how many came due on a read.
 */

import type { FollowUpDetail } from "@krapht/ork-server/client";
import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { toasts } from "../components/toast.tsx";
import { useAppState } from "../state/context.tsx";
import type { FollowUpRow } from "./followups-model.ts";

/** Where the focus goes next: a row, the chosen heading, or the list. */
export type FocusTarget = { row: string } | "heading" | "list";

const SELECTORS = {
  heading: "[data-followups-heading]",
  list: "[data-followups-list]",
} as const;

const targetIn = (root: HTMLElement | null, target: FocusTarget) =>
  root?.querySelector<HTMLElement>(
    typeof target === "string"
      ? SELECTORS[target]
      : `[data-follow-up="${target.row}"]`,
  ) ?? null;

/** Moves the focus once what it goes to is drawn. */
export const useFocusSoon = (root: RefObject<HTMLDivElement | null>) => {
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

type Answer<T> = { id: string; asked: string; value: T };

/** One follow-up's detail: read when it is chosen, and when it changes. */
export const useDetail = (row: FollowUpRow | undefined) => {
  const { client } = useAppState();
  const [detail, setDetail] = useState<Answer<FollowUpDetail> | null>(null);
  const [error, setError] = useState<Answer<string> | null>(null);
  const [attempt, setAttempt] = useState(0);
  const id = row?.id ?? null;
  const project = row?.projectId ?? "";
  const asked = `${id ?? ""}|${project}|${row?.status ?? ""}|${row?.updatedAt ?? ""}|${String(attempt)}`;
  useEffect(() => {
    if (id === null) return () => {};
    let current = true;
    void client
      .call("followUp", { params: { id: project, followUp: id } })
      .then(answer => {
        if (!current) return answer;
        if (answer.ok) {
          setDetail({ id, asked, value: answer.data });
          setError(null);
        } else setError({ id, asked, value: answer.error });
        return answer;
      });
    return () => {
      current = false;
    };
  }, [client, id, project, asked]);
  return {
    detail: detail?.id === id ? detail.value : null,
    error: error?.id === id ? error.value : null,
    reload: useCallback(() => {
      setAttempt(count => count + 1);
    }, []),
  };
};

/** Says aloud how many came due on a read, once per read. */
export const useCameDue = (
  rows: readonly FollowUpRow[] | null,
  announce: (words: string) => void,
  /** Ids the person made due themselves: they are not news. */
  quiet: RefObject<Set<string>>,
): void => {
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (rows === null) return;
    const due = new Set(rows.filter(f => f.status === "due").map(f => f.id));
    const before = seen.current;
    seen.current = due;
    if (before === null) return;
    const news = [...due].filter(id => !before.has(id));
    const came = news.filter(id => !quiet.current.has(id)).length;
    for (const id of news) quiet.current.delete(id);
    if (came > 0) {
      announce(`${String(came)} follow-up${came === 1 ? "" : "s"} came due.`);
    }
  }, [rows, announce, quiet]);
};

/** A toast: what was refused, or what was done. */
export const tell = (toast: { title: string; description: string }): void => {
  toasts.add(toast);
};
