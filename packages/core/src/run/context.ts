/**
 * @file One activation's execute context: what the scheduler hands a node's
 *   executor. Its inputs and the outputs so far, where it works, the budget
 *   left, the human, its hold and its own stop signal (ADR-041), its ports on
 *   the bus, the session it resumes, and, for a leader, its ownership of its
 *   children. And running it: the checkout, the executor under its timeout, and
 *   what the workspace does afterwards.
 */

import type { Node } from "@krapht/ork-schema";

import { createOwnership, type DelegationHooks } from "./delegation.ts";
import type { Activation, NodeResult, RunOptions } from "./handle.ts";
import type { Holds, Stops } from "./holds.ts";
import type { createRunPorts } from "./ports.ts";
import { failure, passThrough, resumeOf } from "./results.ts";
import { foldersOf } from "./scope.ts";
import type { Slots } from "./slots.ts";
import { type createClock, timeoutOf, withTimeout } from "./timeouts.ts";
import type { ExecuteContext, NodeOutput } from "./types.ts";

/** What the scheduler shares with every activation's context. */
export type ContextDeps = {
  options: RunOptions;
  runId: string;
  runDir: string;
  outputs: Record<string, NodeOutput>;
  rounds: Map<string, number>;
  sessionIds: Map<string, string>;
  running: Set<string>;
  /** What is left of `limits.budgetUsd`, when the run has one. */
  budgetLeft: () => number | undefined;
  human: RunOptions["human"];
  holds: Holds;
  stops: Stops;
  ports: ReturnType<typeof createRunPorts>;
  slots: Slots;
  nodeOf: (activation: Activation) => Node | undefined;
  runChild: DelegationHooks["runChild"];
};

export const nodeContext = (
  deps: ContextDeps,
  activation: Activation,
  cwd: string,
): Omit<ExecuteContext, "node" | "checkout"> => {
  const { options, runId } = deps;
  const { graph } = options;
  const { id, template } = activation;
  const context: Omit<ExecuteContext, "node" | "checkout"> = {
    runId,
    id,
    workflow: graph.workflow,
    inputs: options.inputs,
    outputs: deps.outputs,
    input: activation.input,
    round: deps.rounds.get(id) ?? 1,
    cwd,
    runDir: deps.runDir,
    ...foldersOf(options),
    budgetLeftUsd: deps.budgetLeft(),
    human: deps.human,
    hold: deps.holds.forNode(id, template),
    ...deps.ports.forNode(id, template, cwd),
    emit: event => {
      options.onEvent({ type: "node.event", id, event });
    },
    signal: deps.stops.signalFor(id, template),
  };
  if (template !== undefined) context.template = template;
  if (activation.brief !== undefined) context.brief = activation.brief;
  const resume =
    options.replay?.cutOff?.(activation) ??
    resumeOf(deps.nodeOf(activation), deps.sessionIds.get(id));
  if (resume !== undefined) context.resume = resume;
  if (deps.nodeOf(activation)?.type === "claude.leader") {
    context.ownership = createOwnership({
      graph,
      leader: id,
      runChild: deps.runChild,
      isRunning: other => deps.running.has(other),
      checkpoint: () =>
        options.workspace?.checkpoint(id) ?? Promise.resolve(null),
      lend: deps.slots.release,
      reclaim: deps.slots.take,
    });
  }
  return context;
};

/** Runs an activation; control nodes pass their input through. */
export const createExecute =
  (deps: {
    options: RunOptions;
    contextDeps: ContextDeps;
    clock: ReturnType<typeof createClock>;
    graceMs: number;
    nodeOf: (activation: Activation) => Node | undefined;
  }) =>
  async (activation: Activation): Promise<NodeResult> => {
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
      const context = nodeContext(contextDeps, activation, place.cwd);
      const result = await withTimeout({
        timeout: timeoutOf(node, options.graph.workflow),
        clock: clock.forNode(activation.id),
        signal: context.signal,
        graceMs,
        start: signal =>
          executor({
            ...context,
            signal,
            node,
            ...(place.checkout === undefined
              ? {}
              : { checkout: place.checkout }),
          }),
      });
      return (await workspace?.finish(activation.id, result)) ?? result;
    } catch (error) {
      return failure(error instanceof Error ? error.message : String(error));
    }
  };
