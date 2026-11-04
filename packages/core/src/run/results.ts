/**
 * @file Small helpers for the scheduler's results: pass-through and failure
 *   results, run-summary entries, what a run has spent, `node.finished` events,
 *   the declared nodes `run.started` lists, which session a re-run node
 *   resumes, and closing the workspace at the end.
 */

import { isClaudeNode, type Node, type NodeType } from "@krapht/ork-schema";

import type { AgentRef } from "../agents/apply.ts";
import { parseTemplate, renderTemplate, type Scope } from "../expr/evaluate.ts";
import type { CompiledGraph } from "../graph/types.ts";
import type { RunLimits } from "../usage/quota.ts";
import { type EarlierSpend, ownSpend, unreported } from "../usage/spend.ts";
import { declaredNodes } from "./contacts.ts";
import type { Activation, RunOptions } from "./handle.ts";
import type {
  KeptWorktree,
  NodeOutput,
  NodeResult,
  NodeSummary,
  RunEvent,
  Workspace,
  RunResult,
  RunStatus,
} from "./types.ts";

/** Control nodes pass their input through; a join's input is its output. */
export const passThrough = (input: NodeOutput | undefined): NodeResult => ({
  output: input ?? {},
  ok: true,
});

/**
 * A result with only what this activation spent (ADR-046): a session's report
 * holds its total so far, while its tokens are this process's own. `reported`
 * holds each session's total.
 */
export const withOwnSpend = (
  id: string,
  result: NodeResult,
  reported: Map<string, number>,
): NodeResult => {
  const { sessionId, usage } = result;
  if (sessionId === undefined || usage === undefined) return result;
  const own = {
    ...usage,
    costUsd: ownSpend(reported, `${id}/${sessionId}`, usage.costUsd),
  };
  return {
    ...result,
    usage: own,
    output:
      "usage" in result.output
        ? { ...result.output, usage: own }
        : result.output,
  };
};

/** A run's spending so far; a resumed run starts from what it had spent. */
export const createSpend = (
  budgetUsd: number | undefined,
  earlier?: EarlierSpend,
  limits?: () => RunLimits,
) => {
  const reported = new Map(earlier?.reported);
  let spent = earlier?.total ?? 0;
  const budgetLeft = () =>
    budgetUsd === undefined ? undefined : budgetUsd - spent;
  return {
    total: () => spent,
    /** What a session has spent in this activation, from its total so far. */
    ownOf: (id: string, sessionId: string, total: number): number =>
      unreported(reported, `${id}/${sessionId}`, total),
    /** What a session may spend: the least of the budget and any quota. */
    left: () => {
      const known = [budgetLeft(), limits?.().leftUsd].filter(
        left => left !== undefined,
      );
      return known.length === 0 ? undefined : Math.min(...known);
    },
    budgetLeft,
    /** What the limits across runs allow now. */
    quota: (): RunLimits => limits?.() ?? {},
    /**
     * What stops anything new from starting: a quota first, as a budget can be
     * raised.
     */
    spentOut: (): { status: RunStatus; reason: string } | null => {
      const blocked = limits?.().blocked;
      if (blocked !== undefined) {
        return { status: "quota_exhausted", reason: blocked };
      }
      return budgetUsd !== undefined && spent >= budgetUsd
        ? {
            status: "budget_exhausted",
            reason: `the run's budget of $${String(budgetUsd)} is spent`,
          }
        : null;
    },
    /**
     * Counts a result, and gives it back with only its own spend. A replayed
     * result is as stored, and already in what the run started from.
     */
    count: (id: string, result: NodeResult, replayed: boolean): NodeResult => {
      if (replayed) return result;
      const own = withOwnSpend(id, result, reported);
      spent += own.usage?.costUsd ?? 0;
      return own;
    },
  };
};

/** A run's spending, from what the scheduler is given. */
export const spendOf = (
  budgetUsd: number | undefined,
  options: Pick<RunOptions, "replay" | "limits">,
) => createSpend(budgetUsd, options.replay?.earlier, options.limits);

export const recordRun = (entry: NodeSummary, result: NodeResult): void => {
  entry.runs += 1;
  entry.ok = result.ok;
  entry.output = result.output;
  entry.costUsd += result.usage?.costUsd ?? 0;
  if (result.error === undefined) delete entry.error;
  else entry.error = result.error;
};

export const startedEvent = (
  activation: Activation,
  nodeType: NodeType,
  round: number,
  agent?: AgentRef,
): RunEvent => {
  const event: RunEvent = {
    type: "node.started",
    id: activation.id,
    nodeType,
    round,
  };
  if (activation.brief !== undefined) event.owner = activation.brief.from;
  if (agent !== undefined) event.agent = agent;
  return event;
};

export const finishedEvent = (
  id: string,
  round: number,
  result: NodeResult,
): RunEvent => {
  const event: RunEvent = {
    type: "node.finished",
    id,
    round,
    ok: result.ok,
    output: result.output,
  };
  if (result.usage !== undefined) event.usage = result.usage;
  if (result.error !== undefined) event.error = result.error;
  return event;
};

export const failure = (error: string): NodeResult => ({
  output: { status: "fail", summary: error },
  ok: false,
  error,
});

/** The node's entry in the run summary, created on first use. */
export const summaryOf = (
  summaries: Map<string, NodeSummary>,
  id: string,
): NodeSummary => {
  const existing = summaries.get(id);
  if (existing !== undefined) return existing;
  const created: NodeSummary = {
    id,
    runs: 0,
    ok: null,
    output: null,
    costUsd: 0,
  };
  summaries.set(id, created);
  return created;
};

/** The `run.started` event: the workflow, its entries, nodes and inputs. */
export const runStartedEvent = (
  graph: CompiledGraph,
  runId: string,
  options: Pick<RunOptions, "inputs" | "settings">,
): RunEvent => ({
  type: "run.started",
  runId,
  workflow: graph.workflow.name,
  entries: graph.entries,
  nodes: declaredNodes(graph),
  edges: graph.edges.map(({ from, to, when, maxRounds }) => ({
    from,
    to,
    ...(when === undefined ? {} : { when }),
    ...(maxRounds === undefined ? {} : { maxRounds }),
  })),
  channels: graph.channels,
  inputs: options.inputs,
  ...(options.settings === undefined ? {} : { settings: options.settings }),
});

/** The run's result: failed when any reason was given, unless it stopped. */
export const runResult = (run: {
  runId: string;
  stopped: RunStatus | null;
  costUsd: number;
  nodes: NodeSummary[];
  reasons: string[];
  worktrees: KeptWorktree[];
  outputs?: Record<string, string> | undefined;
}): RunResult => ({
  runId: run.runId,
  status: run.stopped ?? (run.reasons.length > 0 ? "failed" : "succeeded"),
  costUsd: run.costUsd,
  nodes: run.nodes,
  reasons: run.reasons,
  worktrees: run.worktrees,
  ...(run.outputs === undefined ? {} : { outputs: run.outputs }),
});

/** A workflow's `outputs`, rendered as the run ends. */
export const renderOutputs = (
  outputs: Record<string, string> | undefined,
  scope: Scope,
): Record<string, string> | undefined =>
  outputs === undefined
    ? undefined
    : Object.fromEntries(
        Object.entries(outputs).map(([name, text]) => {
          const template = parseTemplate(text);
          return [
            name,
            template.ok ? renderTemplate(template.parts, scope) : text,
          ];
        }),
      );

/** Closes the run's worktrees; a failure is one more reason, not a crash. */
export const closeWorkspace = (
  workspace: Workspace | undefined,
  reasons: string[],
): Promise<KeptWorktree[]> =>
  (workspace?.close() ?? Promise.resolve([])).catch((error: unknown) => {
    reasons.push(`cleaning up worktrees: ${String(error)}`);
    return [];
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
