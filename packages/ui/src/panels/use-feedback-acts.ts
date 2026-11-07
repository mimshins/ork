/**
 * @file What the Feedback panel's buttons do, through the server's feedback
 *   routes. Nothing is optimistic: the list and the item are read again after
 *   each action, and what's said aloud, where the focus goes and which item is
 *   chosen follow the server's answer. A refusal of a one-click action is a
 *   toast; a dialog's refusal stays in the dialog, so these hand it back.
 */

import type { BodyOf, FeedbackItem } from "@krapht/ork-server/client";
import { useRef } from "react";

import { toasts } from "../components/toast.tsx";
import type { AppState } from "../state/app-state.ts";
import { shownOf } from "../state/read.ts";
import type { Workspace } from "../workspace/context.ts";
import {
  type FeedbackFilter,
  itemsWords,
  nextAfter,
  short,
  shownItems,
} from "./feedback-model.ts";
import { tokensWords } from "./lesson-model.ts";
import { openRunIn } from "./open-run.ts";

/** Where the focus goes next: a row, the item's heading, or the list. */
export type FocusTarget = { row: string } | "heading" | "list";

export type ActsOptions = {
  state: AppState;
  workspace: Workspace | null;
  filter: FeedbackFilter;
  narrow: boolean;
  choose: (id: string | null) => void;
  focus: (target: FocusTarget) => void;
  reloadDetail: () => void;
};

export const useFeedbackActs = (options: ActsOptions) => {
  const { state, workspace, filter, narrow, choose, focus } = options;
  /** Set while an action moves the choice itself. */
  const moving = useRef(false);
  const itemsNow = (): FeedbackItem[] =>
    shownOf(state.feedback.state.getValue())?.data ?? [];
  /** Shows a run in the Monitor, its heading taking the focus. */
  const arrive = (run: string, node?: string): void => {
    openRunIn(state, workspace, run, node);
  };
  const reloadAll = async (): Promise<void> => {
    await state.feedback.load();
    options.reloadDetail();
  };

  const setStatus = async (
    item: FeedbackItem,
    status: "dismissed" | "new",
  ): Promise<void> => {
    const id = short(item.id);
    const before = shownItems(itemsNow(), filter);
    const answer = await state.client.call("feedbackStatus", {
      params: { id: item.id },
      body: { status },
    });
    if (!answer.ok) {
      const verb = status === "new" ? "restore" : "dismiss";
      toasts.add({
        title: `Could not ${verb} ${id}`,
        description: answer.error,
      });
      return;
    }
    moving.current = true;
    await reloadAll();
    const after = shownItems(itemsNow(), filter);
    if (!after.some(({ id: other }) => other === item.id)) {
      const next = nextAfter(before, after, item.id);
      choose(next?.id ?? null);
      if (next === undefined) focus("list");
      else focus(narrow ? "heading" : { row: next.id });
    }
    moving.current = false;
    workspace?.announce(
      status === "dismissed"
        ? `Dismissed ${id}. It's listed under All and Dismissed.`
        : `Restored ${id} as new.`,
    );
  };

  const accept = async (item: FeedbackItem): Promise<void> => {
    const id = short(item.id);
    const answer = await state.client.call("accept", {
      params: { id: item.id },
      body: { lesson: false },
    });
    if (!answer.ok) {
      toasts.add({
        title: `Could not accept ${id}`,
        description: answer.error,
      });
      return;
    }
    workspace?.announce(`Accepted ${id}.`);
    await reloadAll();
  };

  /** Writes a lesson; resolves to its refusal, or null once it's written. */
  const addLesson = async (
    item: FeedbackItem,
    body: BodyOf<"accept">,
    cap: number,
  ): Promise<string | null> => {
    const answer = await state.client.call("accept", {
      params: { id: item.id },
      body,
    });
    if (!answer.ok) return `Could not add the lesson: ${answer.error}`;
    const { lesson } = answer.data;
    toasts.add({
      title: "Lesson added",
      description:
        lesson === undefined
          ? `${short(item.id)} is accepted.`
          : `\`${lesson.file}\` in \`${lesson.root}\`, ${tokensWords(lesson.tokens, cap)}. Every session of \`${lesson.workflow}\` reads it from now on.`,
    });
    void reloadAll();
    return null;
  };

  /** Starts a run proposing a fix; resolves to its refusal, or null. */
  const apply = async (item: FeedbackItem): Promise<string | null> => {
    const answer = await state.client.call("apply", {
      params: { id: item.id },
      body: {},
    });
    if (!answer.ok) return `Could not start the run: ${answer.error}`;
    const { runId } = answer.data;
    toasts.add({
      title: `Run ${runId} started`,
      description: `\`ork:feedback-apply\` is proposing a fix for ${short(item.id)}. Its question comes to Decisions.`,
    });
    arrive(runId);
    void reloadAll();
    return null;
  };

  const split = async (item: FeedbackItem): Promise<void> => {
    const id = short(item.id);
    const answer = await state.client.call("split", {
      params: { id: item.id },
    });
    if (!answer.ok) {
      toasts.add({ title: `Could not split ${id}`, description: answer.error });
      return;
    }
    focus("heading");
    workspace?.announce(
      `Split ${itemsWords(answer.data.moved)} back out of ${id}.`,
    );
    await reloadAll();
  };

  /** Shows a run, and the node, in the Monitor, its heading taking the focus. */
  const openRun = (run: string, node?: string): void => {
    arrive(run, node);
  };

  return {
    moving,
    setStatus,
    accept,
    addLesson,
    apply,
    split,
    openRun,
    reloadAll,
    /** Says what a person who cancelled a publish should know. */
    announce: (words: string): void => {
      workspace?.announce(words);
    },
  };
};

export type FeedbackActs = ReturnType<typeof useFeedbackActs>;
