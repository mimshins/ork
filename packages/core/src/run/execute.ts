/**
 * @file Running one activation: the checkout, the executor under its timeout
 *   (each look, for a `watch:`), and what the workspace does afterwards.
 */

import type { Node } from "@krapht/ork-schema";

import { type ContextDeps, nodeContext } from "./context.ts";
import { createRunChild, type StartHooks } from "./delegation.ts";
import { createFanOut, type FanOut, forEachOf } from "./fan-out.ts";
import type { Activation, NodeResult, RunOptions } from "./handle.ts";
import {
  endedWith,
  endFor,
  type EndKind,
  endOf,
  failedWith,
  passThrough,
  scrubbedEnd,
  stoppedEnd,
} from "./results.ts";
import { runScope } from "./scope.ts";
import { type createClock, timeoutOf, withTimeout } from "./timeouts.ts";
import type { Checkout, ExecuteContext } from "./types.ts";
import { repeatsCall, runWatch } from "./watch.ts";

export type { ContextDeps, StartHooks };
// The scheduler's fan-out and delegation pieces, so it imports them once.
export { createFanOut, createRunChild, forEachOf };

/** Runs an activation; control nodes pass their input through. */
const saidBy = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * A thrown error's end: a failed git or missing program by its text, else
 * `fallback`.
 */
const thrown = (error: unknown, fallback: EndKind): NodeResult => {
  const text = saidBy(error);
  const read = endOf({ ok: false, output: {}, error: text });
  return failedWith(
    read.kind === "unknown" ? endFor(fallback, { reason: text }, text) : read,
  );
};

type ExecuteDeps = {
  options: RunOptions;
  contextDeps: ContextDeps;
  clock: ReturnType<typeof createClock>;
  graceMs: number;
  nodeOf: (activation: Activation) => Node | undefined;
  fanOut: FanOut;
};

/** Runs an activation, its end's detail scrubbed of the run's paths. */
export const createExecute =
  (deps: ExecuteDeps) =>
  async (activation: Activation, round: number): Promise<NodeResult> =>
    scrubbedEnd(await executeOne(deps, activation, round), [
      deps.options.cwd,
      deps.options.projectRoot ?? "",
    ]);

const executeOne = async (
  deps: ExecuteDeps,
  activation: Activation,
  round: number,
): Promise<NodeResult> => {
  const { options, contextDeps, clock, graceMs, nodeOf } = deps;
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
    const { workspace } = options;
    // A checkout that can't be made, as by a branch rule, stops the node.
    const place = await (
      workspace?.prepare(activation.id, activation.template) ??
      Promise.resolve<{ cwd: string; checkout?: Checkout }>({
        cwd: options.cwd,
      })
    ).catch((error: unknown) => thrown(error, "invalid_node"));
    if ("ok" in place) return place;
    const context = nodeContext(
      contextDeps,
      activation,
      place.cwd,
      round,
      clock,
    );
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
  } catch (error) {
    return thrown(error, "unknown");
  }
};
