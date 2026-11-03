/**
 * @file The notification center's state: items worked out from the overview
 *   stream, which is the truth, and what this browser has read of them. A
 *   decision is an item while it is open, and a run once it has ended, crashed
 *   or paused. On the first visit what has already ended counts as read, so a
 *   new browser does not start with a pile. What still wants the user stays
 *   unread whenever it began.
 */

import type { DecisionRecord, RunView } from "@krapht/ork-server/client";
import { PersistentContainer } from "containerized-state-plugin-persistence";
import { Container } from "react-containerized-state";
import { z } from "zod";

import { type Status, statusWord } from "../components/status-badge.tsx";

const READ_KEY = "ork.notifications.read";
/** The most ids read singly that are kept. */
const READ_KEPT = 200;

const ReadSchema = z.object({
  before: z.string().nullable(),
  ids: z.array(z.string()),
});

type ReadState = z.infer<typeof ReadSchema>;

export type NotificationItem = {
  id: string;
  kind: "decision" | "run";
  runId: string;
  node?: string;
  status: Status;
  /** A sentence that stands alone, for the list and for being said aloud. */
  title: string;
  at: string;
  /** Still wants the user, so an old date does not make it read. */
  pending: boolean;
};

export type ShownNotification = NotificationItem & { unread: boolean };

export type NotificationsView = {
  items: readonly ShownNotification[];
  unread: number;
};

const runItem = (run: RunView): NotificationItem | null => {
  if (run.live === "running") return null;
  const pending = run.live === "paused" || run.live === "crashed";
  return {
    id: `run:${run.id}:${run.live}`,
    kind: "run",
    runId: run.id,
    status: run.live,
    title: `Run ${run.id} of ${run.workflow} ${statusWord(run.live)}.`,
    at: run.finishedAt ?? run.startedAt,
    pending,
  };
};

const decisionItem = (decision: DecisionRecord): NotificationItem => ({
  id: `decision:${decision.id}`,
  kind: "decision",
  runId: decision.runId,
  node: decision.node,
  status: "waiting",
  title: `${decision.node} in run ${decision.runId} asks: ${decision.question}`,
  at: decision.openedAt,
  pending: true,
});

/** Newest first. */
export const itemsOf = (
  runs: readonly RunView[],
  decisions: readonly DecisionRecord[],
): NotificationItem[] =>
  [
    ...decisions.map(decision => decisionItem(decision)),
    ...runs.flatMap(run => runItem(run) ?? []),
  ].toSorted((a, b) => b.at.localeCompare(a.at));

const isRead = (item: NotificationItem, read: ReadState): boolean =>
  read.ids.includes(item.id) ||
  (!item.pending && read.before !== null && item.at <= read.before);

export const createNotifications = ({
  runs,
  decisions,
  storage,
  now = () => new Date().toISOString(),
}: {
  runs: Container<readonly RunView[] | null>;
  decisions: Container<readonly DecisionRecord[] | null>;
  storage: Storage;
  now?: () => string;
}) => {
  const read = new PersistentContainer<ReadState>(
    { before: null, ids: [] },
    { key: READ_KEY, storage },
  );
  if (!ReadSchema.safeParse(read.getValue()).success) void read.reset();
  const view = Container.create<NotificationsView>({ items: [], unread: 0 });
  /** What has been seen, so only what comes after it is new. */
  let known: Set<string> | null = null;
  const listeners = new Set<(fresh: readonly NotificationItem[]) => void>();
  let items: NotificationItem[] = [];

  const show = (): void => {
    const state = read.getValue();
    const shown = items.map(item => ({
      ...item,
      unread: !isRead(item, state),
    }));
    void view.setValue({
      items: shown,
      unread: shown.filter(({ unread }) => unread).length,
    });
  };

  const refresh = (): void => {
    const nextRuns = runs.getValue();
    const nextDecisions = decisions.getValue();
    // Until both have arrived, nothing can be told apart from what is new.
    if (nextRuns === null || nextDecisions === null) return;
    items = itemsOf(nextRuns, nextDecisions);
    if (read.getValue().before === null) {
      void read.setValue({ ...read.getValue(), before: now() });
    }
    const seen = known;
    const fresh = seen === null ? [] : items.filter(({ id }) => !seen.has(id));
    known = new Set(items.map(({ id }) => id));
    show();
    if (fresh.length > 0) {
      for (const listener of listeners) listener(fresh);
    }
  };

  return {
    view,
    /** Follows the streams until the returned function is called. */
    start: (): (() => void) => {
      const stopRuns = runs.subscribe(refresh);
      const stopDecisions = decisions.subscribe(refresh);
      refresh();
      return () => {
        stopRuns();
        stopDecisions();
      };
    },
    /** Hears of items as they come, not those there when the page opened. */
    onNew: (
      listener: (fresh: readonly NotificationItem[]) => void,
    ): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    markRead: (id: string): void => {
      const state = read.getValue();
      void read.setValue({
        ...state,
        ids: [...state.ids, id].slice(-READ_KEPT),
      });
      show();
    },
    markAllRead: (): void => {
      void read.setValue({
        before: now(),
        // What still wants the user is read only by name.
        ids: items
          .filter(({ pending }) => pending)
          .map(({ id }) => id)
          .slice(-READ_KEPT),
      });
      show();
    },
  };
};

export type Notifications = ReturnType<typeof createNotifications>;
