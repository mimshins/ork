/**
 * @file One activation's execute context: what the scheduler hands a node's
 *   executor. Its inputs and the outputs so far, where it works, the budget
 *   left, the human, its hold and its own stop signal (ADR-041), its ports on
 *   the bus, the session it resumes, and, for a leader, its ownership of its
 *   children.
 */

import { isClaudeNode, type Node } from "@krapht/ork-schema";

import { createOwnership, type DelegationHooks } from "./delegation.ts";
import type { Activation, RunOptions } from "./handle.ts";
import type { Holds, Stops } from "./holds.ts";
import type { createRunPorts } from "./ports.ts";
import type { createSpend } from "./results.ts";
import { foldersOf } from "./scope.ts";
import type { Slots } from "./slots.ts";
import type { ExecuteContext, NodeOutput, NodeSummary } from "./types.ts";

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
  /** A node's entry in the run summary, which a fork's spend adds to. */
  summary: (id: string) => NodeSummary;
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
      deps.ports.owners.seen(id, event, cwd);
      options.onEvent({ type: "node.event", id, event });
    },
    signal: deps.stops.signalFor(id, template),
  };
  const owner = ownerPort(deps, id, template);
  if (owner !== undefined) context.owner = owner;
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
      releaseClaims: () => {
        const held = context.claims?.held() ?? [];
        for (const resource of held) context.claims?.release(resource);
        return held;
      },
      lend: deps.slots.release,
      reclaim: deps.slots.take,
    });
  }
  return context;
};

/** Where `id`'s questions go first, if its leader takes them (ADR-063). */
const ownerPort = (
  deps: ContextDeps,
  id: string,
  template: string | undefined,
) =>
  deps.ports.owners.portFor(id, template, {
    budgetLeftUsd: deps.spend.left,
    charge: (owner, sessionId, usage) => {
      // A fork of the owner's session: its spend is the run's, as the owner's.
      const own = deps.spend.count(
        owner,
        { ok: true, output: {}, sessionId, usage },
        false,
      );
      deps.summary(owner).costUsd += own.usage?.costUsd ?? 0;
    },
    emit: (owner, event) => {
      deps.options.onEvent({ type: "node.event", id: owner, event });
    },
  });

/**
 * The session a node that runs again continues, when it resumes (ADR-033): by
 * `session: resume`, the default for a leader; a worker starts fresh unless it
 * says `resume`.
 */
export const resumeOf = (
  node: Node | undefined,
  sessionId: string | undefined,
): string | undefined => {
  if (node === undefined || !isClaudeNode(node)) return undefined;
  if (node.type === "claude.subagent") return undefined;
  const session =
    node.session ?? (node.type === "claude.leader" ? "resume" : "fresh");
  return session === "resume" ? sessionId : undefined;
};
