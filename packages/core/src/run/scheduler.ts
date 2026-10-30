/**
 * @file The scheduler: runs a compiled workflow to the end. It starts entries,
 *   runs each activation through its node type's executor, routes outputs along
 *   edges (`routing.ts`), bounds loops (`escalation.ts`), runs the children a
 *   leader delegates to (`delegation.ts`), and enforces the run's budget and
 *   concurrency (`slots.ts`). Specified in `specs/scheduler.md`.
 */

import { randomUUID } from "node:crypto";
import path from "node:path";

import { isClaudeNode } from "@krapht/ork-schema";

import { createOwnership, type DelegationHooks } from "./delegation.ts";
import { createLoops } from "./escalation.ts";
import {
  declaredNodes,
  failure,
  finishedEvent,
  passThrough,
  recordRun,
  summaryOf,
} from "./results.ts";
import { createRouter } from "./router.ts";
import { runScope } from "./scope.ts";
import { createSlots } from "./slots.ts";
import type {
  Activation,
  ExecuteContext,
  NodeOutput,
  NodeResult,
  NodeSummary,
  RunEvent,
  RunHandle,
  RunOptions,
  RunResult,
  RunStatus,
} from "./types.ts";

export const DEFAULT_CONCURRENCY = 4;

export const startRun = (options: RunOptions): RunHandle => {
  const { graph, onEvent } = options;
  const runId = options.runId ?? randomUUID().slice(0, 8);
  const limits = graph.workflow.limits ?? {};
  const abort = new AbortController();
  const runDir =
    options.runDir ?? path.join(options.cwd, ".ork", "runs", runId);

  const outputs: Record<string, NodeOutput> = {};
  const rounds = new Map<string, number>();
  const sessionIds = new Map<string, string>();
  const running = new Set<string>();
  const summaries = new Map<string, NodeSummary>();
  const queue: Activation[] = [];
  const reasons: string[] = [];
  let busy = 0;
  let spent = 0;
  let stopped: RunStatus | null = null;
  let settled = false;
  const { promise: done, resolve: finish } = Promise.withResolvers<RunResult>();

  // Hoisted through `const` closures: a freed slot pumps the queue.
  const slots = createSlots(limits.concurrency ?? DEFAULT_CONCURRENCY, () => {
    pump();
  });
  const scope = () => runScope(options.inputs, outputs, runId);
  const summary = (id: string): NodeSummary => summaryOf(summaries, id);
  const nodeOf = (activation: Activation) =>
    graph.nodes.get(activation.template ?? activation.id)?.node;

  const stop = (status: RunStatus, reason: string): void => {
    if (stopped !== null) return;
    stopped = status;
    reasons.push(reason);
    queue.length = 0;
  };

  const loops = createLoops({
    human: options.human,
    onEvent,
    activate: (id, input) => {
      queue.push({ id, input });
    },
    fail: reason => {
      stop("failed", reason);
    },
  });
  const router = createRouter({
    graph,
    onEvent,
    scope,
    activate: (id, input) => {
      queue.push({ id, input });
    },
    takeLoop: loops.take,
    skipped: id => {
      summary(id);
    },
    failed: reason => {
      reasons.push(reason);
    },
  });

  const close = async (): Promise<void> => {
    const worktrees = await (
      options.workspace?.close() ?? Promise.resolve([])
    ).catch((error: unknown) => {
      reasons.push(`cleaning up worktrees: ${String(error)}`);
      return [];
    });
    const status = stopped ?? (reasons.length > 0 ? "failed" : "succeeded");
    const result: RunResult = {
      runId,
      status,
      costUsd: spent,
      nodes: [...summaries.values()],
      reasons,
      worktrees,
    };
    onEvent({ type: "run.finished", result });
    finish(result);
  };

  const settle = (): void => {
    if (settled || busy > 0 || queue.length > 0) return;
    settled = true;
    void close();
  };

  /** True, and the run stops, once `limits.budgetUsd` is spent. */
  const budgetSpent = (): boolean => {
    if (limits.budgetUsd === undefined || spent < limits.budgetUsd) {
      return false;
    }
    stop(
      "budget_exhausted",
      `the run's budget of $${String(limits.budgetUsd)} is spent`,
    );
    return true;
  };

  /** A child a leader delegated to: waits for a slot, runs, reports back. */
  const runChild: DelegationHooks["runChild"] = async (child, brief) => {
    await slots.take();
    try {
      if (stopped !== null || budgetSpent()) {
        return failure(`not started: ${reasons[0] ?? "the run stopped"}`);
      }
      return await perform({ ...child, input: undefined, brief });
    } finally {
      slots.release();
    }
  };

  const contextFor = (
    activation: Activation,
    cwd: string,
  ): Omit<ExecuteContext, "node" | "checkout"> => {
    const { id } = activation;
    const context: Omit<ExecuteContext, "node" | "checkout"> = {
      runId,
      id,
      workflow: graph.workflow,
      inputs: options.inputs,
      outputs,
      input: activation.input,
      round: rounds.get(id) ?? 1,
      cwd,
      runDir,
      workflowDir: options.workflowDir ?? options.cwd,
      projectRoot: options.projectRoot ?? options.cwd,
      budgetLeftUsd:
        limits.budgetUsd === undefined ? undefined : limits.budgetUsd - spent,
      human: options.human,
      emit: event => {
        onEvent({ type: "node.event", id, event });
      },
      signal: abort.signal,
    };
    if (activation.template !== undefined) {
      context.template = activation.template;
    }
    if (activation.brief !== undefined) context.brief = activation.brief;
    if (nodeOf(activation)?.type === "claude.leader") {
      const resume = sessionIds.get(id);
      if (resume !== undefined) context.resume = resume;
      context.ownership = createOwnership({
        graph,
        leader: id,
        runChild,
        isRunning: other => running.has(other),
        checkpoint: () =>
          options.workspace?.checkpoint(id) ?? Promise.resolve(null),
        lend: slots.release,
        reclaim: slots.take,
      });
    }
    return context;
  };

  const execute = async (activation: Activation): Promise<NodeResult> => {
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
      const result = await executor({
        ...contextFor(activation, place.cwd),
        node,
        ...(place.checkout === undefined ? {} : { checkout: place.checkout }),
      });
      return (await workspace?.finish(activation.id, result)) ?? result;
    } catch (error) {
      return failure(error instanceof Error ? error.message : String(error));
    }
  };

  /** Runs one activation and records it; routing is the caller's. */
  const perform = async (activation: Activation): Promise<NodeResult> => {
    const { id } = activation;
    const round = (rounds.get(id) ?? 0) + 1;
    rounds.set(id, round);
    running.add(id);
    const started: RunEvent = {
      type: "node.started",
      id,
      nodeType: nodeOf(activation)?.type ?? "control.split",
      round,
    };
    if (activation.brief !== undefined) started.owner = activation.brief.from;
    onEvent(started);

    const result = await execute(activation);
    running.delete(id);
    outputs[id] = result.output;
    if (result.sessionId !== undefined) sessionIds.set(id, result.sessionId);
    spent += result.usage?.costUsd ?? 0;
    recordRun(summary(id), result);
    onEvent(finishedEvent(id, round, result));
    return result;
  };

  const run = async (activation: Activation, isSession: boolean) => {
    const result = await perform(activation);
    if (isSession) slots.release();
    if (stopped === null) await router.route(activation.id, result);
    busy -= 1;
    pump();
  };

  const pump = (): void => {
    for (let index = 0; index < queue.length;) {
      if (stopped !== null) break;
      const activation = queue[index];
      const node = activation && nodeOf(activation);
      if (activation === undefined || node === undefined) {
        queue.splice(index, 1);
        continue;
      }
      const isSession = isClaudeNode(node);
      if (isSession && budgetSpent()) break;
      if (isSession && !slots.tryTake()) {
        index += 1;
        continue;
      }
      queue.splice(index, 1);
      busy += 1;
      void run(activation, isSession);
    }
    settle();
  };

  onEvent({
    type: "run.started",
    runId,
    workflow: graph.workflow.name,
    entries: graph.entries,
    nodes: declaredNodes(graph),
  });
  for (const id of graph.entries) queue.push({ id, input: undefined });
  queueMicrotask(pump);

  return {
    runId,
    done,
    interrupt: () => {
      stop("interrupted", "the run was interrupted");
      abort.abort();
      settle();
    },
  };
};
