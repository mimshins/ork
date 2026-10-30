/**
 * @file Routes a finished node's result through the graph: delivers each edge
 *   `routing.ts` decides to its target's inbox, skips dead paths downstream,
 *   and hands loop edges to the loop counters (`escalation.ts`).
 */

import type { Scope } from "../expr/evaluate.ts";
import type { CompiledEdge, CompiledGraph } from "../graph/types.ts";
import { createInbox, decideEdges, isLoopEdge } from "./routing.ts";
import type { NodeOutput, NodeResult, RunEvent } from "./types.ts";

export type RouterOptions = {
  graph: CompiledGraph;
  onEvent: (event: RunEvent) => void;
  scope: () => Scope;
  activate: (id: string, input: NodeOutput | undefined) => void;
  /** Takes a loop edge whose condition holds; false once it is out of rounds. */
  takeLoop: (edge: CompiledEdge, output: NodeOutput) => Promise<boolean>;
  /** Records a skipped node in the run summary. */
  skipped: (id: string) => void;
  /** A failed node none of whose edges was taken fails the run. */
  failed: (reason: string) => void;
};

export const createRouter = (options: RouterOptions) => {
  const { graph, onEvent } = options;
  const inbox = createInbox(graph);

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
    if (!result.ok && !anyTaken) {
      options.failed(`${id}: ${result.error ?? "failed"}`);
    }
  };

  return { route };
};
