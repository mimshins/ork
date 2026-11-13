/**
 * @file The Follow-ups panel's state: its filters (which outlive a change of
 *   layout), the list they leave, the chosen follow-up and its detail, which of
 *   the two a narrow panel shows, what its buttons do through the server's
 *   routes, and where the focus goes next. Nothing is optimistic: the list is
 *   read again after each action, and what is said aloud, where the focus goes
 *   and which row is chosen follow the server's answer. The list is read when
 *   the panel shows, after every action, on Reload, and every 30 s.
 */

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useValue } from "react-containerized-state";

import { useAppState } from "../state/context.tsx";
import { shownOf } from "../state/read.ts";
import { WorkspaceContext } from "../workspace/context.ts";
import { type Act, doneWords, nextAfter } from "./followups-acts.ts";
import {
  type FollowUpRow,
  githubTarget,
  refusalOf,
} from "./followups-model.ts";
import { openRunIn } from "./open-run.ts";
import { useNarrow } from "./use-feedback.ts";
import {
  tell,
  useCameDue,
  useDetail,
  useFocusSoon,
} from "./use-followups-parts.ts";

/** How often the list reads again while the panel shows. */
export const READ_MS = 30_000;

const VERBS = {
  due: "mark due",
  done: "mark done",
  drop: "drop",
  reopen: "reopen",
} as const;

export const useFollowUps = () => {
  const state = useAppState();
  const workspace = use(WorkspaceContext);
  const filter = useValue(state.followUpsFilter);
  const read = useValue(state.followUps.state);
  const root = useRef<HTMLDivElement>(null);
  const narrow = useNarrow(root);
  const [chosen, setChosen] = useState<string | null>(null);
  const [showing, setShowing] = useState<"list" | "detail">("list");
  const all = shownOf(read)?.data ?? null;
  const rows = useMemo(() => all?.rows ?? [], [all]);
  const row = rows.find(f => f.id === chosen);
  const detail = useDetail(row);
  const focus = useFocusSoon(root);
  const announce = useCallback(
    (words: string): void => {
      workspace?.announce(words);
    },
    [workspace],
  );
  const load = useCallback(() => state.followUps.load(filter), [state, filter]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      void load();
    }, READ_MS);
    return () => {
      clearInterval(timer);
    };
  }, [load]);
  const quiet = useRef(new Set<string>());
  useCameDue(
    all === null ? null : rows,
    JSON.stringify(shownOf(read)?.arg ?? {}),
    announce,
    quiet,
  );

  const choose = useCallback((id: string | null): void => {
    setChosen(id);
    setShowing(id === null ? "list" : "detail");
  }, []);
  const rowsNow = (): FollowUpRow[] =>
    shownOf(state.followUps.state.getValue())?.data.rows ?? [];

  /** After the server changed `changed`: read again, then move the choice. */
  const settle = async (changed: FollowUpRow): Promise<FollowUpRow> => {
    const before = rows;
    await load();
    detail.reload();
    const after = rowsNow();
    if (after.some(f => f.id === changed.id)) focus("heading");
    else {
      const next = nextAfter(before, after, changed.id);
      choose(next?.id ?? null);
      if (next === undefined) focus("list");
      else focus(narrow ? "heading" : { row: next.id });
    }
    return rowsNow().find(f => f.id === changed.id) ?? changed;
  };

  const act = async (target: FollowUpRow, key: Act["key"]): Promise<void> => {
    if (key === "due") quiet.current.add(target.id);
    const answer = await state.client.call("followUpChange", {
      params: { id: target.projectId, followUp: target.id },
      body: { action: key },
    });
    if (!answer.ok) {
      const verb =
        key === "done" && target.kind === "message" ? "mark sent" : VERBS[key];
      tell({ title: `Couldn't ${verb}`, description: answer.error });
      return;
    }
    announce(doneWords(key, await settle(target)));
  };

  /** Posts the draft; resolves to the dialog's refusal, or null once posted. */
  const post = async (
    target: FollowUpRow,
    digest: string,
  ): Promise<string | null> => {
    const answer = await state.client.call("followUpPost", {
      params: { id: target.projectId, followUp: target.id },
      body: { confirm: true, digest },
    });
    if (!answer.ok) {
      detail.reload();
      announce("Not posted.");
      return answer.error.startsWith("The draft is no longer")
        ? "The draft changed since you opened this. Read it again."
        : `Not posted: ${answer.error}. Copy the text and post it yourself, or fix \`gh\` and try again.`;
    }
    const to = githubTarget(target.draft?.to ?? "");
    tell({ title: `Posted to ${to}`, description: "Marked sent." });
    announce(`Posted to ${to}. Marked sent.`);
    void settle(target);
    return null;
  };

  return {
    root,
    narrow,
    read,
    /** The server's refusal of the filter, which keeps the last list. */
    refusal: read.status === "failed" ? refusalOf(read.error) : null,
    all,
    rows,
    filter,
    chosen,
    row,
    detail,
    /** The chosen follow-up is not in the list any more. */
    gone: chosen !== null && all !== null && row === undefined,
    act,
    post,
    announce,
    showing: narrow ? (chosen === null ? "list" : showing) : "both",
    choose: (id: string): void => {
      choose(id);
      if (narrow) focus("heading");
    },
    back: (): void => {
      setShowing("list");
      focus(row === undefined ? "list" : { row: row.id });
    },
    setFilter: (next: typeof filter): void => {
      void state.followUpsFilter.setValue(next);
    },
    reload: (): void => {
      void load();
      detail.reload();
    },
    openRun: (run: string, node?: string): void => {
      openRunIn(state, workspace, run, node);
    },
  };
};

export type FollowUpsView = ReturnType<typeof useFollowUps>;
