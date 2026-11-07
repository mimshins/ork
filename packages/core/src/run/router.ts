/**
 * @file Routes a finished node's result through the graph: delivers each edge
 *   `routing.ts` decides to its target's inbox, skips dead paths downstream,
 *   hands loop edges to the loop counters (`escalation.ts`), resolves as not
 *   taken each edge whose source can't run any more, and counts the failures an
 *   edge handled.
 */

import type { Scope } from "../expr/evaluate.ts";
import type { CompiledEdge, CompiledGraph } from "../graph/types.ts";
import {
  createInbox,
  decideEdges,
  isLoopEdge,
  stuckReason,
} from "./routing.ts";
import type { NodeOutput, NodeResult, RunEvent } from "./types.ts";

export type RouterOptions = {
  graph: CompiledGraph;
  onEvent: (event: RunEvent) => void;
  scope: () => Scope;
  activate: (id: string, input: NodeOutput | undefined) => void;
  /** Takes a loop edge whose condition holds; false once it is out of rounds. */
  takeLoop: (edge: CompiledEdge, output: NodeOutput) => Promise<boolean>;
  /** Whether the run has stopped, as answering a loop's question can make it. */
  stopped: () => boolean;
  /** Records a skipped node in the run summary. */
  skipped: (id: string) => void;
  /** A failed node none of whose edges was taken fails the run. */
  failed: (reason: string) => void;
};

export const createRouter = (options: RouterOptions) => {
  const { graph, onEvent } = options;
  const inbox = createInbox(graph);
  /** Failed results with an edge taken: the run went on (G8, L42). */
  let handled = 0;
  /** How many activations of each node are queued, running or routing. */
  const active = new Map<string, number>();
  const isActive = (id: string) => active.has(id);

  const skip = (id: string): void => {
    options.skipped(id);
    onEvent({ type: "node.skipped", id });
    for (const edge of graph.nodes.get(id)?.outgoing ?? []) {
      if (!isLoopEdge(edge)) deliver(edge, false, {});
    }
  };

  // Hoisted through `const` closures: skip -> deliver -> skip.
  const deliver = (
    edge: CompiledEdge,
    taken: boolean,
    output: NodeOutput,
  ): void => {
    if (taken) onEvent({ type: "edge.taken", from: edge.from, to: edge.to });
    const arrival = inbox.arrive(edge, taken, output);
    if (arrival.kind === "activate") {
      options.activate(edge.to, arrival.input);
    } else if (arrival.kind === "skip") {
      skip(edge.to);
    }
  };

  const route = async (id: string, result: NodeResult): Promise<void> => {
    let anyTaken = false;
    for (const { edge, taken } of decideEdges(
      graph,
      id,
      result,
      options.scope(),
    )) {
      if (options.stopped()) break;
      if (isLoopEdge(edge)) {
        // A loop edge that is not taken changes nothing downstream.
        if (
          taken &&
          // oxlint-disable-next-line no-await-in-loop -- one escalation at a time
          (await options.takeLoop(edge, result.output))
        ) {
          anyTaken = true;
        }
      } else {
        deliver(edge, taken, result.output);
        if (taken) anyTaken = true;
      }
    }
    if (result.ok) return;
    if (anyTaken) handled += 1;
    else options.failed(`${id}: ${result.error ?? "failed"}`);
  };

  /** An activation of `id` is queued; it is active until `done`. */
  const queued = (id: string): void => {
    active.set(id, (active.get(id) ?? 0) + 1);
  };

  /** An activation of `id` has run and routed, or never will. */
  const done = (id: string): void => {
    const count = (active.get(id) ?? 0) - 1;
    if (count > 0) active.set(id, count);
    else active.delete(id);
  };

  /**
   * Resolves as not taken each edge whose source can't run any more, given what
   * is active (queued, running or routing), so a node fed only by branches that
   * didn't run in this round is skipped, and a join waiting on one fires. One
   * target at a time, in graph order, as each can start something.
   */
  const resolveStranded = (): void => {
    for (
      let edges = inbox.stranded(isActive);
      edges.length > 0 && !options.stopped();
      edges = inbox.stranded(isActive)
    ) {
      for (const edge of edges) deliver(edge, false, {});
    }
  };

  /**
   * Routes a finished activation unless the run has stopped, then resolves as
   * not taken what can't run any more in this round.
   */
  const finished = async (id: string, result: NodeResult): Promise<void> => {
    if (!options.stopped()) await route(id, result);
    done(id);
    if (!options.stopped()) resolveStranded();
  };

  /** Why the run fails if a node still waits with nothing left to run. */
  const stuck = (): string[] => {
    const waiting = inbox.waiting();
    return waiting.length === 0 ? [] : [stuckReason(waiting)];
  };

  return {
    route,
    finished,
    queued,
    done,
    stuck,
    handled: () => handled,
  };
};
