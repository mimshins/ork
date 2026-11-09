/**
 * @file Small helpers for the scheduler's results: pass-through and failure
 *   results, run-summary entries, `node.finished` events, the declared nodes
 *   `run.started` lists, the run's result (with what a `succeeded` run left
 *   out: skipped nodes, handled failures, unread mail), and closing the
 *   workspace at the end.
 */

import type { NodeType } from "@krapht/ork-schema";

import type { AgentRef } from "../agents/apply.ts";
import { parseTemplate, renderTemplate, type Scope } from "../expr/evaluate.ts";
import type { CompiledGraph } from "../graph/types.ts";
import type { EarlierSpend } from "../usage/spend.ts";
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
  UnreadMail,
} from "./types.ts";

export { spendOf } from "./spending.ts";

/** Control nodes pass their input through; a join's input is its output. */
export const passThrough = (input: NodeOutput | undefined): NodeResult => ({
  output: input ?? {},
  ok: true,
});

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
  const { item } = activation;
  if (item !== undefined) event.item = { of: item.of, index: item.index };
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

/** A run's summary; a resumed run's leaders keep their forks' spend (ADR-063). */
export const createSummaries = (earlier: EarlierSpend | undefined) => {
  const summaries = new Map<string, NodeSummary>();
  const summary = (id: string): NodeSummary => summaryOf(summaries, id);
  for (const [id, costUsd] of earlier?.forks ?? []) {
    summary(id).costUsd += costUsd;
  }
  return { summaries, summary };
};

/** The tighter of the workflow's budget and what a caller left it, if any. */
const runBudget = (
  graph: CompiledGraph,
  settings: RunOptions["settings"],
): { budgetUsd?: number } => {
  const limits = [graph.workflow.limits?.budgetUsd, settings?.budgetCap].filter(
    limit => limit !== undefined,
  );
  return limits.length === 0 ? {} : { budgetUsd: Math.min(...limits) };
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
  ...runBudget(graph, options.settings),
});

/** The unread mail of nodes that never ran; a node that ran saw its notice. */
const unreadOf = (
  nodes: readonly NodeSummary[],
  unread: ReadonlyMap<string, number> | undefined,
): { unread?: UnreadMail[] } => {
  const ran = new Set(nodes.filter(node => node.runs > 0).map(node => node.id));
  const left = [...(unread ?? [])]
    .filter(([node]) => !ran.has(node))
    .map(([node, messages]) => ({ node, messages }));
  return left.length === 0 ? {} : { unread: left };
};

/**
 * The run's result: failed when any reason was given, unless it stopped. A
 * skipped node or a handled failure leaves it `succeeded`, and is counted.
 */
export const runResult = (run: {
  runId: string;
  stopped: RunStatus | null;
  costUsd: number;
  nodes: NodeSummary[];
  reasons: string[];
  worktrees: KeptWorktree[];
  outputs?: Record<string, string> | undefined;
  failuresHandled: number;
  /** Each node's unread messages, from the bus. */
  unread?: ReadonlyMap<string, number>;
}): RunResult => ({
  runId: run.runId,
  status: run.stopped ?? (run.reasons.length > 0 ? "failed" : "succeeded"),
  costUsd: run.costUsd,
  nodes: run.nodes,
  reasons: run.reasons,
  worktrees: run.worktrees,
  ...(run.outputs === undefined ? {} : { outputs: run.outputs }),
  skipped: run.nodes.filter(node => node.runs === 0).length,
  failuresHandled: run.failuresHandled,
  ...unreadOf(run.nodes, run.unread),
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
