/**
 * @file Talking to a called run (RFC-004): linking the caller's nodes with a
 *   called node, and handing a later activation's input to it. A live session
 *   gets the input as a message. One that has ended gets it by being resumed,
 *   once its run has ended too.
 */

import { socketPath, wakeRun } from "../control/socket.ts";
import type { CallRequest } from "../run/calls.ts";
import { endedWith, endFor, failedWith, failure } from "../run/results.ts";
import type { NodeResult } from "../run/types.ts";
import type { RunRecord } from "../store/types.ts";
import { usageRowsOf } from "../store/usage.ts";
import { liveStatus, runTree } from "../store/view.ts";
import {
  type CallWatch,
  finishedRun,
  followRun,
  lastSeq,
  noWait,
  waitForNode,
  waitForRun,
} from "./call-wait.ts";
import { flattenTree } from "./commands.ts";
import { addressOf, linkNodes } from "./links.ts";

export type CallTalk = CallWatch & {
  runId: string;
  /** Resumes a finished node's session; why it could not, or `null`. */
  resumeSession?:
    | ((
        run: RunRecord,
        node: string,
        body: string,
        signal: AbortSignal,
      ) => Promise<string | null>)
    | undefined;
};

/**
 * Links the nodes in the call's channels once the called run has recorded
 * itself.
 */
export const linkChannels = async (
  talk: CallTalk,
  id: string,
  request: CallRequest,
  signal: AbortSignal,
): Promise<string | null> => {
  if (request.node === undefined || request.channels.length === 0) return null;
  const ready = await followRun(talk, id, 0, signal, event =>
    event.type === "run.started" ? true : undefined,
  );
  if (ready !== true) return `Run ${id} did not start.`;
  const peer = { run: id, node: request.node };
  for (const own of request.channels) {
    // oxlint-disable-next-line no-await-in-loop -- one link at a time, in order
    const linked = await linkNodes(
      talk.store,
      addressOf({ run: talk.runId, node: own }),
      addressOf(peer),
      {
        maxMessages: request.maxMessages,
        home: talk.home,
        by: "A workflow.call",
      },
    );
    if (!linked.ok) return linked.error;
  }
  request.linked(addressOf(peer));
  return null;
};

/** Hands the activation's input to the called node, as a message. */
export const tellInput = (
  { store, runId, home }: CallTalk,
  id: string,
  request: CallRequest,
): void => {
  if (request.input === undefined || request.node === undefined) return;
  store.command(id, {
    kind: "relay",
    node: request.node,
    from: `${runId}/${request.callId}`,
    body: JSON.stringify(request.input),
  });
  void wakeRun(socketPath(id, home));
};

/** Whether the node has reported, so no session of it is there to be told. */
const hasEnded = ({ store }: CallTalk, id: string, node: string): boolean => {
  const events = store.events(id).map(stored => stored.event);
  const found = flattenTree(runTree(events)).find(n => n.id === node);
  return found?.state === "ok" || found?.state === "failed";
};

const resumeNode = async (
  talk: CallTalk,
  run: RunRecord,
  request: CallRequest,
  node: string,
  signal: AbortSignal,
): Promise<NodeResult> => {
  const { store } = talk;
  if (talk.resumeSession === undefined) {
    return failure(
      `Run ${run.id} has finished, and its session cannot be resumed here.`,
    );
  }
  const from = lastSeq(store, run.id);
  const body = `[ork] The workflow that called this run activated it again, from ${talk.runId}/${request.callId}. This is from that workflow, not from the user. Its input: ${JSON.stringify(request.input ?? {})}`;
  const refused = await talk.resumeSession(run, node, body, signal);
  if (refused !== null) return failure(refused);
  const finished = store
    .events(run.id, from)
    .flatMap(({ event }) =>
      event.type === "node.event" &&
      event.event.type === "session.finished" &&
      event.id === node
        ? [event.event.outcome]
        : [],
    )
    .at(-1);
  if (finished?.report === null || finished === undefined) {
    const said = `${node} ended without a report when resumed.`;
    return failedWith(endFor("no_report", {}, said), {
      status: "fail",
      summary: said,
    });
  }
  const ok = finished.report.status !== "fail";
  // The session reports its total so far; the caller pays for this turn only.
  const own = usageRowsOf(run, store.events(run.id))
    .filter(row => row.seq > from && row.node === node)
    .reduce((sum, row) => sum + row.costUsd, 0);
  return endedWith(
    {
      ok,
      output: { ...finished.report, run: run.id },
      usage: {
        ...finished.usage,
        costUsd: own + talk.newCost(run.id),
      },
    },
    endFor(ok ? "done" : "reported_failure"),
  );
};

/** A later activation: as a message, or by resuming a session that has ended. */
export const continueConversation = async (
  talk: CallTalk,
  id: string,
  request: CallRequest,
  signal: AbortSignal,
): Promise<NodeResult> => {
  const { store } = talk;
  const node = request.node ?? "";
  const isLive = (): boolean => {
    const [now] = store.lookup(id);
    return now !== undefined && liveStatus(now) === "running";
  };
  if (isLive() && !hasEnded(talk, id, node)) {
    const from = lastSeq(store, id);
    tellInput(talk, id, request);
    if (request.wait === "none") return noWait(id);
    return request.wait === "run"
      ? waitForRun(talk, id, from, signal)
      : waitForNode(talk, id, node, from, signal);
  }
  // A session reported, and the nodes after it are still working.
  if (isLive()) {
    await followRun(talk, id, lastSeq(store, id), signal, finishedRun);
  }
  const [run] = store.lookup(id);
  if (run === undefined) return failure(`Run ${id} is gone.`);
  if (signal.aborted) {
    const said = `Stopped while run ${id} was finishing.`;
    return failedWith(endFor("interrupted", {}, said), {
      status: "fail",
      summary: said,
    });
  }
  return resumeNode(talk, run, request, node, signal);
};
