/**
 * @file Commands to a live run from another process (`ork stop`, `ork pause`,
 *   `ork continue`, `ork chat`, the local server): each is checked against the
 *   run's stored events, written as a row in the store, then a wake on the
 *   run's socket so the run acts at once instead of at its next poll
 *   (specs/messaging.md#reaching-a-live-run, ADR-041).
 */

import { socketPath, wakeRun } from "../control/socket.ts";
import type { EventStore, RunCommand, RunRecord } from "../store/types.ts";
import { liveStatus, pausedOf, runTree, type TreeNode } from "../store/view.ts";

export type Commanded =
  | { ok: true; woke: boolean }
  | { ok: false; error: string };

/** Sends a live run's node a message; false when the run did not wake. */
export const tellLiveRun = (
  store: EventStore,
  run: RunRecord,
  node: string,
  body: string,
  home?: string,
): Promise<boolean> => {
  store.command(run.id, { kind: "message", node, body });
  return wakeRun(socketPath(run.id, home));
};

const notRunning = (run: RunRecord): string | null => {
  const status = liveStatus(run);
  return status === "running"
    ? null
    : `Run ${run.id} is not running (${status}).`;
};

/**
 * A run of one node (`ork run <wf> --node n`) has no scheduler to hold or to
 * fail one node through, so it takes only a stop of the whole run.
 */
const oneNode = (
  run: RunRecord,
  cannot: "pause or continue" | "stop by name",
): string | null =>
  run.id.startsWith("node-")
    ? `Run ${run.id} runs one node, which it cannot ${cannot}; stop the whole run instead: ork stop ${run.id}`
    : null;

/** Every node of a run's tree, spawned instances included. */
export const flattenTree = (nodes: readonly TreeNode[]): TreeNode[] =>
  nodes.flatMap(node => [node, ...flattenTree(node.children)]);

/** What a run's stored events say about it now. */
const stateOf = (store: EventStore, run: RunRecord) => {
  const events = store.events(run.id).map(stored => stored.event);
  return { paused: pausedOf(events), nodes: flattenTree(runTree(events)) };
};

/** Queues `command` and wakes the run, unless there is a `refusal`. */
const request = async (
  store: EventStore,
  run: RunRecord,
  command: RunCommand,
  refusal: string | null,
  home?: string,
): Promise<Commanded> => {
  if (refusal !== null) return { ok: false, error: refusal };
  store.command(run.id, command);
  return { ok: true, woke: await wakeRun(socketPath(run.id, home)) };
};

const stopRefusal = (
  store: EventStore,
  run: RunRecord,
  node: string | undefined,
): string | null => {
  const refused = notRunning(run);
  if (refused !== null || node === undefined) return refused;
  const single = oneNode(run, "stop by name");
  if (single !== null) return single;
  const named = stateOf(store, run).nodes.filter(
    n => n.id === node || n.template === node,
  );
  if (named.length === 0) return `${node} is not a node of run ${run.id}.`;
  return named.some(n => n.state === "running")
    ? null
    : `${node} is not running in run ${run.id}.`;
};

const pauseRefusal = (
  store: EventStore,
  run: RunRecord,
  node: string | undefined,
): string | null => {
  const refused = notRunning(run) ?? oneNode(run, "pause or continue");
  if (refused !== null) return refused;
  const { paused, nodes } = stateOf(store, run);
  if (paused.run) return `Run ${run.id} is already paused.`;
  if (node === undefined) return null;
  if (!nodes.some(n => n.id === node)) {
    return `${node} is not a node of run ${run.id}.`;
  }
  return paused.nodes.includes(node)
    ? `${node} is already paused in run ${run.id}.`
    : null;
};

const continueRefusal = (
  store: EventStore,
  run: RunRecord,
  node: string | undefined,
): string | null => {
  const refused = notRunning(run) ?? oneNode(run, "pause or continue");
  if (refused !== null) return refused;
  const { paused } = stateOf(store, run);
  if (node === undefined) {
    return paused.run || paused.nodes.length > 0
      ? null
      : `Run ${run.id} is not paused.`;
  }
  if (paused.nodes.includes(node)) return null;
  return paused.run
    ? `Run ${run.id} is paused as a whole; continue the run, not ${node}.`
    : `${node} is not paused in run ${run.id}.`;
};

const withNode = (
  kind: "stop" | "pause" | "continue",
  node: string | undefined,
): RunCommand => (node === undefined ? { kind } : { kind, node });

/**
 * Asks a live run to stop, or one of its running nodes. The run finishes its
 * running nodes first, so it may still be running when this returns; a node
 * stopped this way fails, and the run goes on.
 */
export const requestStop = (
  store: EventStore,
  run: RunRecord,
  home?: string,
  node?: string,
): Promise<Commanded> =>
  request(
    store,
    run,
    withNode("stop", node),
    stopRefusal(store, run, node),
    home,
  );

/**
 * Asks a live run to pause, or one of its nodes: nothing new starts, and
 * running sessions hold at their next tool call (ADR-041).
 */
export const requestPause = (
  store: EventStore,
  run: RunRecord,
  home?: string,
  node?: string,
): Promise<Commanded> =>
  request(
    store,
    run,
    withNode("pause", node),
    pauseRefusal(store, run, node),
    home,
  );

/** Releases a pause: the run's (and with it every node's), or one node's. */
export const requestContinue = (
  store: EventStore,
  run: RunRecord,
  home?: string,
  node?: string,
): Promise<Commanded> =>
  request(
    store,
    run,
    withNode("continue", node),
    continueRefusal(store, run, node),
    home,
  );
