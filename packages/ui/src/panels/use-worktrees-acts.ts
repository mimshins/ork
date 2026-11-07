/**
 * @file What the Worktrees panel's buttons do: Open run goes to the Monitor;
 *   Remove… and Clean merged… open their dialogs and, once the server has done
 *   the work, read the list again and say what went. A removed row leaves at
 *   once, from the server's answer, and the focus goes to the same button in
 *   the row now in its place; a cancelled dialog gives it back to the button it
 *   opened from. Nothing is optimistic before the answer.
 */

import type {
  RemovePlanAnswer,
  WorktreeRow,
  WorktreesProject,
} from "@krapht/ork-server/client";
import { type RefObject, use, useMemo, useRef, useState } from "react";

import { useAppState } from "../state/context.tsx";
import { WorkspaceContext } from "../workspace/context.ts";
import { openRunIn } from "./open-run.ts";
import type { RowActs } from "./worktree-card.tsx";
import { removedSaid } from "./worktrees-model.ts";

export type Opened =
  | {
      kind: "remove";
      row: WorktreeRow;
      project: WorktreesProject;
      target: { project: string; key: string };
      /** Where the row stood among all the panel's rows. */
      index: number;
      /** Each opening starts the dialog afresh. */
      id: number;
    }
  | { kind: "clean"; id: number }
  | null;

const ROW = "[data-worktree-row]";

/** A row's place among the panel's rows, by its key. */
const indexOf = (panel: HTMLElement | null, key: string): number =>
  [...(panel?.querySelectorAll<HTMLElement>(ROW) ?? [])].findIndex(
    row => row.dataset["worktreeRow"] === key,
  );

export const useWorktreesActs = (
  panel: RefObject<HTMLDivElement | null>,
  load: () => Promise<void>,
) => {
  const state = useAppState();
  const workspace = use(WorkspaceContext);
  /** The last dialog opened, kept while it closes, so it gives the focus back. */
  const [opened, setOpened] = useState<Opened>(null);
  const [open, setOpen] = useState(false);
  /** Rows the server removed, hidden until the next read lands. */
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  /** Where Remove… sends the focus: back, to the Monitor, or a row's place. */
  const afterRemove = useRef<"back" | "run" | number>("back");
  const cleanButton = useRef<HTMLButtonElement>(null);
  const openings = useRef(0);

  const rowActs: RowActs = useMemo(
    () => ({
      openRun: row => {
        openRunIn(state, workspace, row.runId, row.nodeId);
      },
      remove: (row, project) => {
        afterRemove.current = "back";
        setOpened({
          kind: "remove",
          row,
          project,
          target: { project: project.root, key: row.key },
          index: indexOf(panel.current, row.key),
          id: openings.current + 1,
        });
        openings.current += 1;
        setOpen(true);
      },
    }),
    [state, workspace, panel],
  );

  /** The same button in the row now at `index`, or the panel when none. */
  const focusAfterRemoval = (index: number): HTMLElement | boolean => {
    const rows = panel.current?.querySelectorAll<HTMLElement>(ROW) ?? [];
    const row = rows[Math.min(index, rows.length - 1)];
    return (
      row?.querySelector<HTMLElement>('[data-act="remove"]') ??
      panel.current ??
      false
    );
  };

  return {
    opened,
    open,
    gone,
    rowActs,
    cleanButton,
    openClean: (): void => {
      openings.current += 1;
      setOpened({ kind: "clean", id: openings.current });
      setOpen(true);
    },
    close: (): void => {
      setOpen(false);
    },
    removed: (
      row: WorktreeRow,
      project: WorktreesProject,
      plan: RemovePlanAnswer,
      index: number,
    ): void => {
      workspace?.announce(removedSaid(row, plan));
      afterRemove.current = index;
      setGone(before => new Set([...before, `${project.root}|${row.key}`]));
      setOpen(false);
      void load().finally(() => {
        setGone(new Set());
      });
    },
    /** Where Remove… gives the focus back when it closes. */
    removeFocus: (): HTMLElement | boolean =>
      typeof afterRemove.current === "number"
        ? focusAfterRemoval(afterRemove.current)
        : afterRemove.current === "back",
    cleanClosed: (cleaned: boolean): void => {
      if (!cleaned) workspace?.announce("Nothing was removed.");
      setOpen(false);
    },
    cleanFocus: (): HTMLElement | boolean => cleanButton.current ?? true,
    openRemovedRun: (row: WorktreeRow): void => {
      afterRemove.current = "run";
      setOpen(false);
      openRunIn(state, workspace, row.runId, row.nodeId);
    },
  };
};

export type WorktreesActs = ReturnType<typeof useWorktreesActs>;
