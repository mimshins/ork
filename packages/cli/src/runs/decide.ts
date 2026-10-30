/**
 * @file `ork decide`: the open decisions of live runs, from any terminal, and
 *   answering them. An answer goes to the store (the first one wins), then the
 *   run is woken on its socket so it picks the answer up at once.
 */

import {
  type DecisionRecord,
  type EventStore,
  liveStatus,
  socketPath,
  wakeRun,
} from "@krapht/ork-core";

/** Open decisions whose run is still live, oldest first. */
export const pendingDecisions = (
  store: EventStore,
  filter: { runId?: string; project?: string },
): DecisionRecord[] => {
  const live = new Map<string, boolean>();
  return store.decisions({ ...filter, status: "open" }).filter(decision => {
    if (!live.has(decision.runId)) {
      const [run] = store.lookup(decision.runId);
      live.set(
        decision.runId,
        run !== undefined && liveStatus(run) === "running",
      );
    }
    return live.get(decision.runId) === true;
  });
};

export type Answered =
  | { ok: true; woke: boolean }
  | { ok: false; error: string };

/** Answers an open decision with one of its options, and wakes its run. */
export const answerDecision = async (
  store: EventStore,
  id: string,
  choice: string,
  home?: string,
): Promise<Answered> => {
  const decision = store.decision(id);
  if (decision === undefined)
    return { ok: false, error: `No decision "${id}".` };
  if (!decision.options.some(o => o.id === choice)) {
    return {
      ok: false,
      error: `"${choice}" is not an option of ${id}: ${decision.options.map(o => o.id).join(", ")}`,
    };
  }
  if (!store.answerDecision(id, choice, "decide")) {
    const now = store.decision(id);
    return {
      ok: false,
      error:
        now?.status === "answered"
          ? `${id} was already answered: ${now.answer ?? ""} (${now.answeredBy ?? ""})`
          : `${id} was withdrawn`,
    };
  }
  return { ok: true, woke: await wakeRun(socketPath(decision.runId, home)) };
};
