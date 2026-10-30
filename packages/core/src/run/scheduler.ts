/**
 * @file The scheduler: runs a compiled workflow to the end. It starts entries,
 *   runs each activation through its node type's executor, routes outputs along
 *   edges (`routing.ts`), bounds loops, and enforces the run's budget and
 *   concurrency. Specified in `specs/scheduler.md`.
 */

import { randomUUID } from "node:crypto";

import { isClaudeNode } from "@krapht/ork-schema";

import type { Scope } from "../expr/evaluate.ts";
import type { CompiledEdge, CompiledGraph } from "../graph/types.ts";
import type { HumanChannel } from "../runtime/types.ts";
import { askAboutLoop, LOOP_CHOICES } from "./escalation.ts";
import { failure, finishedEvent, passThrough, recordRun } from "./results.ts";
import { createInbox, decideEdges, edgeKey, isLoopEdge } from "./routing.ts";
import { runScope } from "./scope.ts";
import type {
  Inputs,
  NodeExecutors,
  NodeOutput,
  NodeResult,
  NodeSummary,
  RunEvent,
  RunResult,
  RunStatus,
} from "./types.ts";

export const DEFAULT_CONCURRENCY = 4;

export type RunOptions = {
  graph: CompiledGraph;
  inputs: Inputs;
  cwd: string;
  executors: NodeExecutors;
  human: HumanChannel;
  onEvent: (event: RunEvent) => void;
  runId?: string;
};

export type RunHandle = {
  runId: string;
  done: Promise<RunResult>;
  /** Stops starting nodes and aborts the running ones. */
  interrupt: () => void;
};

type Activation = { id: string; input: NodeOutput | undefined };

export const startRun = (options: RunOptions): RunHandle => {
  const { graph, onEvent } = options;
  const runId = options.runId ?? randomUUID().slice(0, 8);
  const limits = graph.workflow.limits ?? {};
  const concurrency = limits.concurrency ?? DEFAULT_CONCURRENCY;
  const abort = new AbortController();
  const inbox = createInbox(graph);

  const outputs: Record<string, NodeOutput> = {};
  const rounds = new Map<string, number>();
  const summaries = new Map<string, NodeSummary>();
  const loopTaken = new Map<string, number>();
  const loopExtra = new Map<string, number>();
  const queue: Activation[] = [];
  const reasons: string[] = [];
  let sessions = 0;
  let busy = 0;
  let spent = 0;
  let stopped: RunStatus | null = null;
  let settled = false;
  const { promise: done, resolve: finish } = Promise.withResolvers<RunResult>();

  const scope = (): Scope => runScope(options.inputs, outputs, runId);

  const summary = (id: string): NodeSummary => {
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

  const stop = (status: RunStatus, reason: string): void => {
    if (stopped !== null) return;
    stopped = status;
    reasons.push(reason);
    queue.length = 0;
  };

  const settle = (): void => {
    if (settled || busy > 0 || queue.length > 0) return;
    settled = true;
    const status = stopped ?? (reasons.length > 0 ? "failed" : "succeeded");
    const result: RunResult = {
      runId,
      status,
      costUsd: spent,
      nodes: [...summaries.values()],
      reasons,
    };
    onEvent({ type: "run.finished", result });
    finish(result);
  };

  const budgetLeft = (): number | undefined =>
    limits.budgetUsd === undefined ? undefined : limits.budgetUsd - spent;

  const skip = (id: string): void => {
    summary(id);
    onEvent({ type: "node.skipped", id });
    for (const edge of graph.nodes.get(id)?.outgoing ?? []) {
      if (!isLoopEdge(edge)) deliver(edge, false, {});
    }
  };

  // Hoisted through `const` closures: deliver -> enqueue -> pump -> run.
  const deliver = (
    edge: CompiledEdge,
    taken: boolean,
    output: NodeOutput,
  ): void => {
    if (taken) onEvent({ type: "edge.taken", from: edge.from, to: edge.to });
    const arrival = inbox.arrive(edge, taken, output);
    if (arrival.kind === "activate") {
      queue.push({ id: edge.to, input: arrival.input });
    } else if (arrival.kind === "skip") {
      skip(edge.to);
    }
  };

  /** A loop edge whose condition holds: taken, unless it is out of rounds. */
  const takeLoop = async (
    edge: CompiledEdge,
    output: NodeOutput,
  ): Promise<boolean> => {
    const key = edgeKey(edge);
    const taken = loopTaken.get(key) ?? 0;
    const bound = (edge.maxRounds ?? 0) + (loopExtra.get(key) ?? 0);
    if (taken < bound) {
      loopTaken.set(key, taken + 1);
      queue.push({ id: edge.to, input: output });
      onEvent({ type: "edge.taken", from: edge.from, to: edge.to });
      return true;
    }
    onEvent({
      type: "loop.exhausted",
      from: edge.from,
      to: edge.to,
      maxRounds: edge.maxRounds ?? 0,
    });
    const choice = await askAboutLoop(options.human, edge);
    if (choice === LOOP_CHOICES.again) {
      loopExtra.set(key, (loopExtra.get(key) ?? 0) + 1);
      return takeLoop(edge, output);
    }
    if (choice !== LOOP_CHOICES.onward) {
      stop("failed", `the loop ${edge.from} -> ${edge.to} ran out of rounds`);
    }
    return false;
  };

  const route = async (id: string, result: NodeResult): Promise<void> => {
    let anyTaken = false;
    for (const { edge, taken } of decideEdges(graph, id, result, scope())) {
      if (isLoopEdge(edge)) {
        // A loop edge that is not taken changes nothing downstream.
        // oxlint-disable-next-line no-await-in-loop -- one escalation at a time
        if (taken && (await takeLoop(edge, result.output))) anyTaken = true;
      } else {
        deliver(edge, taken, result.output);
        if (taken) anyTaken = true;
      }
    }
    if (!result.ok && !anyTaken) {
      reasons.push(`${id}: ${result.error ?? "failed"}`);
    }
  };

  const execute = async (activation: Activation): Promise<NodeResult> => {
    const { id } = activation;
    const node = graph.nodes.get(id)?.node;
    if (node === undefined) return failure(`unknown node ${id}`);
    if (node.type.startsWith("control.")) return passThrough(activation.input);
    const executor = options.executors[node.type];
    if (executor === undefined) return failure(`no executor for ${node.type}`);
    try {
      return await executor({
        runId,
        id,
        node,
        workflow: graph.workflow,
        inputs: options.inputs,
        outputs,
        input: activation.input,
        round: rounds.get(id) ?? 1,
        cwd: options.cwd,
        budgetLeftUsd: budgetLeft(),
        human: options.human,
        emit: event => {
          onEvent({ type: "node.event", id, event });
        },
        signal: abort.signal,
      });
    } catch (error) {
      return failure(error instanceof Error ? error.message : String(error));
    }
  };

  const run = async (activation: Activation, isSession: boolean) => {
    const { id } = activation;
    const round = (rounds.get(id) ?? 0) + 1;
    rounds.set(id, round);
    const nodeType = graph.nodes.get(id)?.node.type ?? "control.split";
    onEvent({ type: "node.started", id, nodeType, round });

    const result = await execute(activation);
    if (isSession) sessions -= 1;
    outputs[id] = result.output;
    spent += result.usage?.costUsd ?? 0;
    recordRun(summary(id), result);
    onEvent(finishedEvent(id, round, result));

    if (stopped === null) await route(id, result);
    busy -= 1;
    pump();
  };

  const pump = (): void => {
    for (let index = 0; index < queue.length;) {
      if (stopped !== null) break;
      const activation = queue[index];
      const node = activation && graph.nodes.get(activation.id)?.node;
      if (activation === undefined || node === undefined) {
        queue.splice(index, 1);
        continue;
      }
      const isSession = isClaudeNode(node);
      if (isSession && sessions >= concurrency) {
        index += 1;
        continue;
      }
      const left = budgetLeft();
      if (isSession && left !== undefined && left <= 0) {
        stop(
          "budget_exhausted",
          `the run's budget of $${String(limits.budgetUsd)} is spent`,
        );
        break;
      }
      queue.splice(index, 1);
      if (isSession) sessions += 1;
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
