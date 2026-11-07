/**
 * @file The builder's state: the workflow open, what's selected, and each
 *   change sent to the server, which holds the draft and answers with the new
 *   text and problems. What's open lives in the page's state
 *   (state/builder-session.ts), so a panel moved, closed or stacked shows it
 *   again. Changes go one at a time and in order, and read what they build on
 *   when their turn comes, so nothing acts on a stale view. An answer about a
 *   workflow that's no longer open changes nothing on screen. Undo is this
 *   page's history, up to the last save.
 */

import type {
  BuilderView,
  CallResult,
  WorkflowEdit,
} from "@krapht/ork-server/client";
import { useCallback, useState } from "react";
import { useValue } from "react-containerized-state";

import { toasts } from "../components/toast.tsx";
import type { Opened, Step } from "../state/builder-session.ts";
import { useAppState } from "../state/context.tsx";
import { readAt, sameJson } from "./builder-model.ts";
import type { FormPath } from "./form-parts.tsx";
import { useBuilderLists } from "./use-builder-lists.ts";

const paramsOf = ({ project, name }: Opened) => ({ id: project, name });

export const useBuilder = () => {
  const { client, builder: session } = useAppState();
  // The containers: a turn reads what they hold when it runs, which may be
  // newer than this render.
  const { inTurn, history, view: viewNow, opened: openedNow } = session;
  const opened = useValue(openedNow);
  const view = useValue(viewNow);
  const selected = useValue(session.selected);
  const canUndo = useValue(history).length > 0;
  const [connecting, setConnecting] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [replaceAsked, setReplaceAsked] = useState<string | null>(null);
  const lists = useBuilderLists(client);
  const { schema, catalog, drafts, setDrafts, refreshDrafts, forProject } =
    lists;

  const writeHistory = useCallback(
    (steps: readonly Step[]): void => {
      void history.setValue(steps);
    },
    [history],
  );

  const isOpen = useCallback(
    (target: Opened): boolean => {
      const now = openedNow.getValue();
      return now?.project === target.project && now.name === target.name;
    },
    [openedNow],
  );

  /** What's open now, with nothing carried over from what was before. */
  const showOpened = useCallback(
    (target: Opened | null, shown: BuilderView | null): void => {
      session.show(target, shown);
      setConnecting(false);
      setRefusal(null);
      setReplaceAsked(null);
    },
    [session],
  );

  const chooseProject = useCallback(
    (project: string): void => {
      forProject(project);
      const current = openedNow.getValue();
      if (current !== null && current.project !== project) {
        showOpened(null, null);
      }
    },
    [forProject, openedNow, showOpened],
  );

  /** Shows an answer about `target`, if it's still what's open. */
  const take = useCallback(
    (target: Opened, answer: CallResult<BuilderView>): boolean => {
      if (!isOpen(target)) return answer.ok;
      if (answer.ok) {
        session.update(answer.data);
        setRefusal(null);
        return true;
      }
      setRefusal(answer.error);
      return false;
    },
    [isOpen, session],
  );

  const open = useCallback(
    (project: string, name: string): Promise<void> =>
      inTurn(async () => {
        const target = { project, name };
        const answer = await client.call("builderView", {
          params: paramsOf(target),
        });
        if (answer.ok) showOpened(target, answer.data);
        else setRefusal(answer.error);
      }),
    [client, inTurn, showOpened],
  );

  const create = useCallback(
    (project: string, name: string): Promise<boolean> =>
      inTurn(async () => {
        const answer = await client.call("builderCreate", {
          params: { id: project },
          body: { name },
        });
        if (!answer.ok) {
          setRefusal(answer.error);
          return false;
        }
        showOpened({ project, name }, answer.data);
        setDrafts(current => [...current, name]);
        return true;
      }),
    [client, inTurn, setDrafts, showOpened],
  );

  const send = useCallback(
    async (target: Opened, edits: WorkflowEdit[]): Promise<boolean> => {
      const answer = await client.call("builderEdit", {
        params: paramsOf(target),
        body: { edits },
      });
      const done = take(target, answer);
      if (
        answer.ok &&
        isOpen(target) &&
        answer.data.text !== answer.data.previous.text
      ) {
        writeHistory([...history.getValue(), answer.data.previous]);
      }
      return done;
    },
    [client, history, isOpen, take, writeHistory],
  );

  const edit = useCallback(
    (...edits: WorkflowEdit[]): Promise<boolean> =>
      opened === null
        ? Promise.resolve(false)
        : inTurn(() => send(opened, edits)),
    [inTurn, opened, send],
  );

  /**
   * Changes the value at `path` from whatever it is when this turn comes, so a
   * row added right after typing in another keeps what was typed.
   */
  const change = useCallback(
    (path: FormPath, next: (current: unknown) => unknown): Promise<boolean> => {
      if (opened === null) return Promise.resolve(false);
      return inTurn(() => {
        if (!isOpen(opened)) return Promise.resolve(false);
        const current = readAt(viewNow.getValue()?.document, path);
        const value = next(current);
        if (sameJson(current, value)) return Promise.resolve(true);
        const at = [...path];
        return send(opened, [
          value === undefined
            ? { op: "delete", path: at }
            : { op: "set", path: at, value },
        ]);
      });
    },
    [inTurn, isOpen, opened, send, viewNow],
  );

  const undo = useCallback(
    (): Promise<void> =>
      opened === null
        ? Promise.resolve()
        : inTurn(async () => {
            const last = history.getValue().at(-1);
            if (last === undefined || !isOpen(opened)) return;
            const answer = await client.call("builderRestore", {
              params: paramsOf(opened),
              body: last,
            });
            if (take(opened, answer)) {
              writeHistory(history.getValue().slice(0, -1));
            }
          }),
    [client, history, inTurn, isOpen, opened, take, writeHistory],
  );

  const discard = useCallback(
    (): Promise<void> =>
      opened === null
        ? Promise.resolve()
        : inTurn(async () => {
            const answer = await client.call("builderDiscard", {
              params: paramsOf(opened),
            });
            refreshDrafts();
            if (!isOpen(opened)) return;
            if (!answer.ok) {
              setRefusal(answer.error);
              return;
            }
            if ("gone" in answer.data) showOpened(null, null);
            else showOpened(opened, answer.data);
          }),
    [client, inTurn, isOpen, opened, refreshDrafts, showOpened],
  );

  /** Saves; true once what's shown is what's in the file. */
  const save = useCallback(
    (force = false): Promise<boolean> => {
      if (opened === null) return Promise.resolve(false);
      const params = paramsOf(opened);
      return inTurn(async () => {
        const answer = await client.call("builderSave", {
          params,
          body: force ? { force: true } : {},
        });
        if (!answer.ok) {
          setRefusal(answer.error);
          return false;
        }
        if (!answer.data.saved) {
          if (answer.data.why === "changed") {
            setReplaceAsked(answer.data.message);
          } else {
            setRefusal(answer.data.message);
          }
          return false;
        }
        setRefusal(null);
        refreshDrafts();
        // Older text can't come back: undoing past a save could put back what
        // someone else has since replaced, with no one asked.
        if (isOpen(opened)) writeHistory([]);
        take(opened, await client.call("builderView", { params }));
        toasts.add({ title: `Saved ${opened.name}` });
        return true;
      });
    },
    [client, inTurn, isOpen, opened, refreshDrafts, take, writeHistory],
  );

  return {
    opened,
    view,
    selected,
    connecting,
    refusal,
    canUndo,
    replaceAsked,
    schema,
    catalog,
    drafts,
    chooseProject,
    open,
    create,
    edit,
    change,
    undo,
    discard,
    save,
    /** The person selects a card, or none: the Context panel follows. */
    select: session.select,
    setConnecting,
    setReplaceAsked,
  };
};

export type Builder = ReturnType<typeof useBuilder>;
