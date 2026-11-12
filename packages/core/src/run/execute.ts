/**
 * @file Running one activation: a control node passes its input through, a
 *   fanned node runs its items, and any other runs in its place
 *   (`execute-placed.ts`), under its lock when it names one (RFC-016).
 */

import type { Node } from "@krapht/ork-schema";

import type { ContextDeps } from "./context.ts";
import { createRunChild, type StartHooks } from "./delegation.ts";
import { executePlaced, type PlacedDeps, thrown } from "./execute-placed.ts";
import { createFanOut, type FanOut, forEachOf } from "./fan-out.ts";
import type { Activation, NodeResult } from "./handle.ts";
import { createRunLocks, type RunLocks } from "./locks.ts";
import {
  endFor,
  failedWith,
  passThrough,
  scrubbedEnd,
  stoppedEnd,
} from "./results.ts";
import { runScope } from "./scope.ts";

export type { ContextDeps, StartHooks };
// The scheduler's fan-out and delegation pieces, so it imports them once.
export { createFanOut, createRunChild, forEachOf };

type ExecuteDeps = PlacedDeps & {
  nodeOf: (activation: Activation) => Node | undefined;
  fanOut: FanOut;
};

/**
 * Runs activations, each end's detail scrubbed of the run's paths; and the
 * run's locks, which the run lets go when it ends.
 */
export const createExecute = (
  deps: ExecuteDeps,
): {
  execute: (activation: Activation, round: number) => Promise<NodeResult>;
  locks: RunLocks;
} => {
  const { options, contextDeps, clock } = deps;
  const { runId, outputs } = contextDeps;
  const locks = createRunLocks({
    graph: options.graph,
    ledgers: options.locks,
    runId,
    scope: item => runScope(options.inputs, outputs, runId, item),
    onEvent: options.onEvent,
    waitFor: clock.waitFor,
  });
  return {
    execute: async (activation, round) =>
      scrubbedEnd(await executeOne(deps, locks, activation, round), [
        options.cwd,
        options.projectRoot ?? "",
      ]),
    locks,
  };
};

const executeOne = async (
  deps: ExecuteDeps,
  locks: RunLocks,
  activation: Activation,
  round: number,
): Promise<NodeResult> => {
  const { options, contextDeps, nodeOf } = deps;
  const node = nodeOf(activation);
  // Neither can happen with a compiled graph: Ork's own bug, filed as one.
  if (node === undefined) {
    return failedWith(endFor("unknown", {}, `unknown node ${activation.id}`));
  }
  if (node.type.startsWith("control.")) return passThrough(activation.input);
  const executor = options.executors[node.type];
  if (executor === undefined) {
    return failedWith(endFor("unknown", {}, `no executor for ${node.type}`));
  }
  try {
    const forEach = activation.item === undefined ? forEachOf(node) : undefined;
    if (forEach !== undefined) {
      return await deps.fanOut(activation, forEach, round);
    }
    if (!("lock" in node) || node.lock === undefined) {
      return await executePlaced(deps, activation, round, node, executor);
    }
    // A lock is taken before the checkout, and held until its merge is done.
    const signal = contextDeps.stops.signalFor(
      activation.id,
      activation.template,
    );
    if (!(await locks.enter(activation, signal))) {
      return failedWith(stoppedEnd(signal));
    }
    try {
      return await executePlaced(deps, activation, round, node, executor);
    } finally {
      locks.leave(activation);
    }
  } catch (error) {
    return thrown(error, "unknown");
  }
};
