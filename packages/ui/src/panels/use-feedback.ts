/**
 * @file What the Feedback panel reads. The list has no stream of its own, so
 *   it's read when the panel shows, after every action, on Reload, and when the
 *   runs change while it shows, at most every 5 s (a run that records feedback
 *   changes on the overview stream). An item's detail is read when it's chosen
 *   and whenever its item changes in the list. The panel lays itself out by its
 *   own width, since the list and detail swap in a narrow one.
 */

import type { Client, FeedbackDetail } from "@krapht/ork-server/client";
import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useValue } from "react-containerized-state";

import type { AppState } from "../state/app-state.ts";

/** How often the list follows the runs, at most. */
export const FOLLOW_MS = 5000;

/** The width, in rem, from which the list and the detail sit side by side. */
const WIDE_REM = 48;

const FALLBACK_REM_PX = 16;

export const useFeedbackList = (state: AppState) => {
  const read = useValue(state.feedback.state);
  const runs = useValue(state.runs);
  const lastRead = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seenRuns = useRef(runs);
  const load = useCallback(async (): Promise<void> => {
    lastRead.current = Date.now();
    await state.feedback.load();
  }, [state]);
  useEffect(() => {
    void load();
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [load]);
  useEffect(() => {
    if (seenRuns.current === runs) return;
    seenRuns.current = runs;
    if (timer.current !== null) return;
    const wait = Math.max(0, lastRead.current + FOLLOW_MS - Date.now());
    timer.current = setTimeout(() => {
      timer.current = null;
      void load();
    }, wait);
  }, [runs, load]);
  return { read, load };
};

type Answer<T> = { id: string; value: T };

export const useFeedbackDetail = (
  client: Client,
  id: string | null,
  /** Changes when the item does, which is a reason to read it again. */
  stamp: string,
) => {
  const [detail, setDetail] = useState<Answer<FeedbackDetail> | null>(null);
  const [error, setError] = useState<Answer<string> | null>(null);
  const [answered, setAnswered] = useState("");
  const [attempt, setAttempt] = useState(0);
  const asked = `${id ?? ""}|${stamp}|${String(attempt)}`;
  useEffect(() => {
    if (id === null) return () => {};
    let current = true;
    void client.call("feedbackItem", { params: { id } }).then(answer => {
      if (!current) return answer;
      setAnswered(asked);
      if (answer.ok) {
        setDetail({ id, value: answer.data });
        setError(null);
      } else {
        setError({ id, value: answer.error });
      }
      return answer;
    });
    return () => {
      current = false;
    };
  }, [client, id, asked]);
  const reload = useCallback(() => {
    setAttempt(count => count + 1);
  }, []);
  return {
    detail: detail?.id === id ? detail.value : null,
    error: error?.id === id ? error.value : null,
    loading: id !== null && answered !== asked,
    reload,
  };
};

export type DetailRead = ReturnType<typeof useFeedbackDetail>;

/** Whether the element is narrower than the side-by-side layout needs. */
export const useNarrow = (element: RefObject<HTMLElement | null>): boolean => {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const shown = element.current;
    if (shown === null) return () => {};
    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? 0;
      // A hidden panel measures nothing: it keeps the layout it had.
      if (width === 0) return;
      const size = getComputedStyle(document.documentElement).fontSize;
      const rem = Number(size.replace("px", "")) || FALLBACK_REM_PX;
      setNarrow(width < WIDE_REM * rem);
    });
    observer.observe(shown);
    return () => {
      observer.disconnect();
    };
  }, [element]);
  return narrow;
};
