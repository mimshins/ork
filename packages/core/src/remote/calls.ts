/**
 * @file A run's way to call workflows (RFC-004): each activation starts the
 *   workflow as a separate run, or attaches to one a resumed caller had
 *   started, and hands back its outputs or a node's report. A call that names a
 *   node keeps one run as a conversation, one activation at a time. What a
 *   called run spends counts against its caller, and stopping the caller stops
 *   what it called.
 */

import type { CallPort, CallRequest } from "../run/calls.ts";
import { failure } from "../run/results.ts";
import type { NodeResult, RunEvent } from "../run/types.ts";
import { liveStatus } from "../store/view.ts";
import {
  type AdoptedCall,
  reviveCall,
  startCall,
  type StartOptions,
} from "./call-start.ts";
import {
  type CallTalk,
  continueConversation,
  linkChannels,
  tellInput,
} from "./call-talk.ts";
import { noWait, storedReport, waitForNode, waitForRun } from "./call-wait.ts";
import { requestStop } from "./commands.ts";

export type CallsOptions = StartOptions &
  Pick<CallTalk, "resumeSession"> & {
    /** Records `call.started` in this run's events. */
    emit: (event: RunEvent) => void;
    home?: string | undefined;
    /** What a run being resumed had called (`adoptedCalls`). */
    adopt?: ReadonlyMap<string, AdoptedCall> | undefined;
  };

/** An activation's run: new, or attached to, with what of it to read. */
type Begun =
  | { ok: true; id: string; fresh: boolean; after: number }
  | { ok: false; error: string };

export const createCalls = (options: CallsOptions): CallPort => {
  const { store, emit, home } = options;
  /** Every run this one started, for a stop to reach. */
  const started = new Set<string>();
  /** What has been counted of each called run's cost. */
  const counted = new Map<string, number>();
  /** Call node -> the run it keeps talking to. */
  const conversations = new Map<string, string>();
  /** Each conversation's last activation: they take turns. */
  const queues = new Map<string, Promise<unknown>>();
  /** What this run's activations attach to again, each run once. */
  const adopt = new Map(
    [...(options.adopt ?? [])].map(([node, adopted]) => {
      for (const run of [...adopted.open, adopted.last]) started.add(run);
      for (const [run, cost] of adopted.counted) counted.set(run, cost);
      return [node, { ...adopted, open: [...adopted.open] }];
    }),
  );

  const newCost = (id: string): number => {
    const total = store.lookup(id)[0]?.costUsd ?? 0;
    const known = counted.get(id) ?? 0;
    counted.set(id, Math.max(total, known));
    return Math.max(total - known, 0);
  };
  const talk: CallTalk = { ...options, newCost };

  const isRunning = (id: string): boolean => {
    const [run] = store.lookup(id);
    return run !== undefined && liveStatus(run) === "running";
  };

  const stop = (id: string): void => {
    const [run] = store.lookup(id);
    if (run !== undefined && isRunning(id)) void requestStop(store, run, home);
  };

  /** Stops the called run when this node is aborted, until the returned call. */
  const stopOnAbort = (id: string, signal: AbortSignal): (() => void) => {
    const aborted = (): void => {
      stop(id);
    };
    // Stopped while the run was starting: no event will come for this.
    if (signal.aborted) aborted();
    signal.addEventListener("abort", aborted, { once: true });
    return () => {
      signal.removeEventListener("abort", aborted);
    };
  };

  const begin = async (request: CallRequest): Promise<Begun> => {
    const adopted = adopt.get(request.callId)?.open.shift();
    if (adopted !== undefined) {
      const revived = await reviveCall(options, adopted);
      return revived.ok
        ? { ok: true, id: adopted, fresh: false, after: revived.after }
        : revived;
    }
    const begun = await startCall(options, request);
    if (!begun.ok) return begun;
    started.add(begun.id);
    emit({
      type: "call.started",
      node: request.callId,
      run: begun.id,
      workflow: request.workflow,
      project: begun.project,
    });
    return { ok: true, id: begun.id, fresh: true, after: 0 };
  };

  /**
   * A conversation left between activations by a caller that was resumed: its
   * run comes back as any called run does, and its links, which ended with the
   * caller, are made again. Returns why it could not.
   */
  const adoptConversation = async (
    request: CallRequest,
    signal: AbortSignal,
  ): Promise<string | null> => {
    const adopted = adopt.get(request.callId);
    if (adopted === undefined || adopted.open.length > 0) return null;
    adopt.delete(request.callId);
    conversations.set(request.callId, adopted.last);
    const revived = await reviveCall(options, adopted.last);
    if (!revived.ok) return revived.error;
    return isRunning(adopted.last)
      ? linkChannels(talk, adopted.last, request, signal)
      : null;
  };

  const converse = async (
    request: CallRequest,
    signal: AbortSignal,
  ): Promise<NodeResult> => {
    const unadopted = await adoptConversation(request, signal);
    if (unadopted !== null) return failure(unadopted);
    const known = conversations.get(request.callId);
    if (known !== undefined) {
      const done = stopOnAbort(known, signal);
      try {
        return await continueConversation(talk, known, request, signal);
      } finally {
        done();
      }
    }
    const begun = await begin(request);
    adopt.delete(request.callId);
    if (!begun.ok) return failure(begun.error);
    const { id, after, fresh } = begun;
    conversations.set(request.callId, id);
    const done = stopOnAbort(id, signal);
    try {
      if (fresh || isRunning(id)) {
        const refused = await linkChannels(talk, id, request, signal);
        if (refused !== null) {
          stop(id);
          return failure(refused);
        }
      }
      if (fresh) tellInput(talk, id, request);
      if (request.wait === "none") return noWait(id);
      if (!fresh && request.wait === "node") {
        const earlier = storedReport(talk, id, request.node ?? "");
        if (earlier !== undefined) return earlier;
      }
      return request.wait === "run"
        ? await waitForRun(talk, id, after, signal)
        : await waitForNode(talk, id, request.node ?? "", after, signal);
    } finally {
      done();
    }
  };

  const callOnce = async (
    request: CallRequest,
    signal: AbortSignal,
  ): Promise<NodeResult> => {
    const begun = await begin(request);
    if (!begun.ok) return failure(begun.error);
    const { id, after } = begun;
    // Stopped while the run was starting, a stop had nothing to reach yet.
    const done = stopOnAbort(id, signal);
    try {
      if (request.wait === "none") return noWait(id);
      return await waitForRun(talk, id, after, signal);
    } finally {
      done();
    }
  };

  return {
    invoke: (request, signal) => {
      if (request.node === undefined) return callOnce(request, signal);
      const turn = (queues.get(request.callId) ?? Promise.resolve())
        .catch(() => null)
        .then(() => converse(request, signal));
      queues.set(request.callId, turn);
      return turn;
    },
    stopAll: () => {
      for (const id of started) stop(id);
    },
  };
};
