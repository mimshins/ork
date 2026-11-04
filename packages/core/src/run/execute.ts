/**
 * @file Running one activation: the checkout, the executor under its timeout
 *   (each look, for a `watch:`), and what the workspace does afterwards.
 */

import type { Node } from "@krapht/ork-schema";

import { type ContextDeps, nodeContext } from "./context.ts";
import type { Activation, NodeResult, RunOptions } from "./handle.ts";
import { failure, passThrough } from "./results.ts";
import { runScope } from "./scope.ts";
import { type createClock, timeoutOf, withTimeout } from "./timeouts.ts";
import type { ExecuteContext } from "./types.ts";
import { repeatsCall, runWatch } from "./watch.ts";

export type { ContextDeps };

/** Runs an activation; control nodes pass their input through. */
export const createExecute =
  (deps: {
    options: RunOptions;
    contextDeps: ContextDeps;
    clock: ReturnType<typeof createClock>;
    graceMs: number;
    nodeOf: (activation: Activation) => Node | undefined;
  }) =>
  async (activation: Activation, round: number): Promise<NodeResult> => {
    const { options, contextDeps, clock, graceMs, nodeOf } = deps;
    const node = nodeOf(activation);
    if (node === undefined) return failure(`unknown node ${activation.id}`);
    if (node.type.startsWith("control.")) return passThrough(activation.input);
    const executor = options.executors[node.type];
    if (executor === undefined) return failure(`no executor for ${node.type}`);
    try {
      const { workspace } = options;
      const place = (await workspace?.prepare(
        activation.id,
        activation.template,
      )) ?? { cwd: options.cwd };
      const context = nodeContext(contextDeps, activation, place.cwd, round);
      const once = (
        signal: AbortSignal,
        emit: ExecuteContext["emit"],
      ): Promise<NodeResult> =>
        withTimeout({
          timeout: timeoutOf(node, options.graph.workflow),
          clock: clock.forNode(activation.id),
          signal,
          graceMs,
          start: inner =>
            executor({
              ...context,
              emit,
              signal: inner,
              node,
              ...(place.checkout === undefined
                ? {}
                : { checkout: place.checkout }),
            }),
        });
      const watch = "watch" in node ? node.watch : undefined;
      const result =
        watch === undefined
          ? await once(context.signal, context.emit)
          : await runWatch({
              id: activation.id,
              watch,
              declared: "output" in node ? node.output?.schema : undefined,
              look: (signal, quiet) =>
                once(signal, event => {
                  if (!quiet || !repeatsCall(event)) context.emit(event);
                }),
              scope: () =>
                runScope(
                  options.inputs,
                  contextDeps.outputs,
                  contextDeps.runId,
                ),
              hold: context.hold,
              signal: context.signal,
              graceMs,
              onEvent: options.onEvent,
              resting: on => {
                clock.resting(activation.id, on);
              },
              everyMs: options.watchEveryMs,
            });
      return (await workspace?.finish(activation.id, result)) ?? result;
    } catch (error) {
      return failure(error instanceof Error ? error.message : String(error));
    }
  };
