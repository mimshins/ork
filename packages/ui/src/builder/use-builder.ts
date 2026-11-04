/**
 * @file The builder's state: the workflow open, what's selected, and each
 *   change sent to the server, which holds the draft and answers with the new
 *   text and problems. Changes go one at a time and in order, and read what
 *   they build on when their turn comes, so nothing acts on a stale view. An
 *   answer about a workflow that's no longer open changes nothing on screen.
 *   Undo is this session's history, up to the last save.
 */

import type {
  BuilderEditAnswer,
  BuilderView,
  CallResult,
  WorkflowEdit,
} from "@krapht/ork-server/client";
import { useCallback, useRef, useState } from "react";

import { toasts } from "../components/toast.tsx";
import { useAppState } from "../state/context.tsx";
import { readAt, sameJson } from "./builder-model.ts";
import type { FormPath } from "./form-parts.tsx";
import { useBuilderLists } from "./use-builder-lists.ts";

export type Opened = { project: string; name: string };

/** One step back: the text, and the file it was based on. */
type Step = BuilderEditAnswer["previous"];

const paramsOf = ({ project, name }: Opened) => ({ id: project, name });

export const useBuilder = () => {
  const { client } = useAppState();
  const [opened, setOpenedState] = useState<Opened | null>(null);
  const [view, setView] = useState<BuilderView | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [replaceAsked, setReplaceAsked] = useState<string | null>(null);
  const lists = useBuilderLists(client);
  const { schema, catalog, drafts, setDrafts, refreshDrafts, forProject } =
    lists;
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  // What a turn reads when it runs, which may be newer than this render.
  const latest = useRef<BuilderView | null>(null);
  const openedNow = useRef<Opened | null>(null);
  const history = useRef<readonly Step[]>([]);

  /** Runs after everything sent before it. */
  const inTurn = useCallback(<T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.current.then(work, work);
    queue.current = next.catch(() => null);
    return next;
  }, []);

  const writeHistory = useCallback((steps: readonly Step[]): void => {
    history.current = steps;
    setCanUndo(steps.length > 0);
  }, []);

  const isOpen = useCallback(
    (target: Opened): boolean =>
      openedNow.current?.project === target.project &&
      openedNow.current.name === target.name,
    [],
  );

  /** What's open now, with nothing carried over from what was before. */
  const showOpened = useCallback(
    (target: Opened | null, shown: BuilderView | null): void => {
      openedNow.current = target;
      latest.current = shown;
      setOpenedState(target);
      setView(shown);
      setSelected(null);
      setConnecting(false);
      setRefusal(null);
      setReplaceAsked(null);
      writeHistory([]);
    },
    [writeHistory],
  );

  const chooseProject = useCallback(
    (project: string): void => {
      forProject(project);
      const current = openedNow.current;
      if (current !== null && current.project !== project) {
        showOpened(null, null);
      }
    },
    [forProject, showOpened],
  );

  /** Shows an answer about `target`, if it's still what's open. */
  const take = useCallback(
    (target: Opened, answer: CallResult<BuilderView>): boolean => {
      if (!isOpen(target)) return answer.ok;
      if (answer.ok) {
        latest.current = answer.data;
        setView(answer.data);
        setRefusal(null);
        return true;
      }
      setRefusal(answer.error);
      return false;
    },
    [isOpen],
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
        writeHistory([...history.current, answer.data.previous]);
      }
      return done;
    },
    [client, isOpen, take, writeHistory],
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
        const current = readAt(latest.current?.document, path);
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
    [inTurn, isOpen, opened, send],
  );

  const undo = useCallback(
    (): Promise<void> =>
      opened === null
        ? Promise.resolve()
        : inTurn(async () => {
            const last = history.current.at(-1);
            if (last === undefined || !isOpen(opened)) return;
            const answer = await client.call("builderRestore", {
              params: paramsOf(opened),
              body: last,
            });
            if (take(opened, answer)) {
              writeHistory(history.current.slice(0, -1));
            }
          }),
    [client, inTurn, isOpen, opened, take, writeHistory],
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
    select: setSelected,
    setConnecting,
    setReplaceAsked,
  };
};

export type Builder = ReturnType<typeof useBuilder>;
