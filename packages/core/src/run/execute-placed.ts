/**
 * @file Running one activation in its place: the checkout, the executor under
 *   its timeout (each look, for a `watch:`), and what the workspace does
 *   afterwards. `execute.ts` decides what runs; this runs it.
 */

import type { Node } from "@krapht/ork-schema";

import { type ContextDeps, nodeContext } from "./context.ts";
import type { Activation, NodeResult, RunOptions } from "./handle.ts";
import {
  endedWith,
  endFor,
  type EndKind,
  endOf,
  failedWith,
  stoppedEnd,
} from "./results.ts";
import { runScope } from "./scope.ts";
import { type createClock, timeoutOf, withTimeout } from "./timeouts.ts";
import type { Checkout, ExecuteContext, NodeExecutor } from "./types.ts";
import { repeatsCall, runWatch } from "./watch.ts";

const saidBy = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * A thrown error's end: a failed git or missing program by its text, else
 * `fallback`.
 */
export const thrown = (error: unknown, fallback: EndKind): NodeResult => {
  const text = saidBy(error);
  const read = endOf({ ok: false, output: {}, error: text });
  return failedWith(
    read.kind === "unknown" ? endFor(fallback, { reason: text }, text) : read,
  );
};

export type PlacedDeps = {
  options: RunOptions;
  contextDeps: ContextDeps;
  clock: ReturnType<typeof createClock>;
  graceMs: number;
};

/** Runs an activation in its checkout, under its timeout. */
export const executePlaced = async (
  deps: PlacedDeps,
  activation: Activation,
  round: number,
  node: Node,
  executor: NodeExecutor,
): Promise<NodeResult> => {
  const { options, contextDeps, clock, graceMs } = deps;
  const { workspace } = options;
  // A checkout that can't be made, as by a branch rule, stops the node.
  const place = await (
    workspace?.prepare(activation.id, activation.template) ??
    Promise.resolve<{ cwd: string; checkout?: Checkout }>({
      cwd: options.cwd,
    })
  ).catch((error: unknown) => thrown(error, "invalid_node"));
  if ("ok" in place) return place;
  const context = nodeContext(contextDeps, activation, place.cwd, round, clock);
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
          ...(place.checkout === undefined ? {} : { checkout: place.checkout }),
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
            runScope(options.inputs, contextDeps.outputs, contextDeps.runId),
          hold: context.hold,
          signal: context.signal,
          graceMs,
          onEvent: options.onEvent,
          resting: on => {
            clock.resting(activation.id, on);
          },
          everyMs: options.watchEveryMs,
        });
  // An interrupt (or the run's timeout) comes before any other end
  // (specs/runtime/session-ends.md).
  const ended =
    result.ok || !context.signal.aborted
      ? result
      : endedWith(result, stoppedEnd(context.signal));
  return (await workspace?.finish(activation.id, ended)) ?? ended;
};
