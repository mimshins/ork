/**
 * @file One activation's execute context: what the scheduler hands a node's
 *   executor. Its inputs and the outputs so far, where it works, the budget
 *   left, the human, its hold and its own stop signal (ADR-041), its ports on
 *   the bus, the session it resumes, and, for a leader, its ownership of its
 *   children.
 */

import type { Node } from "@krapht/ork-schema";

import { createOwnership, type DelegationHooks } from "./delegation.ts";
import type { Activation, RunOptions } from "./handle.ts";
import type { Holds, Stops } from "./holds.ts";
import type { createRunPorts } from "./ports.ts";
import { type createSpend, resumeOf } from "./results.ts";
import { foldersOf } from "./scope.ts";
import type { Slots } from "./slots.ts";
import type { ExecuteContext, NodeOutput } from "./types.ts";

/** What the scheduler shares with every activation's context. */
export type ContextDeps = {
  options: RunOptions;
  runId: string;
  runDir: string;
  outputs: Record<string, NodeOutput>;
  sessionIds: Map<string, string>;
  running: Set<string>;
  /** What the run has spent, and what is left of its budget and any quota. */
  spend: ReturnType<typeof createSpend>;
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
  round: number,
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
    round,
    cwd,
    runDir: deps.runDir,
    ...foldersOf(options),
    budgetLeftUsd: deps.spend.left(),
    budgetLeftNow: deps.spend.budgetLeft,
    quota: deps.spend.quota,
    ownSpend: (sessionId, total) => deps.spend.ownOf(id, sessionId, total),
    human: deps.human,
    hold: deps.holds.forNode(id, template),
    ...deps.ports.forNode(id, template, cwd),
    ...(options.calls === undefined ? {} : { calls: options.calls }),
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
