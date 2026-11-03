/**
 * @file The scheduler: runs a compiled workflow to the end: entries, executors,
 *   routing (`routing.ts`), loops (`escalation.ts`), delegated children
 *   (`delegation.ts`), the bus, claims and feedback (`ports.ts`), the budget
 *   and concurrency (`slots.ts`), pause, continue and a node's stop
 *   (`holds.ts`, ADR-041), and timeouts (`timeouts.ts`, ADR-043).
 */

import { type ContextDeps, createExecute } from "./context.ts";
import { createLoops } from "./escalation.ts";
import type {
  Activation,
  NodeOutput,
  NodeResult,
  NodeSummary,
  RunHandle,
  RunOptions,
  RunResult,
  RunStatus,
} from "./handle.ts";
import { createHolds, createStops } from "./holds.ts";
import { createRunPorts } from "./ports.ts";
import {
  closeWorkspace,
  failure,
  finishedEvent,
  renderOutputs,
  recordRun,
  runResult,
  runStartedEvent,
  startedEvent,
  summaryOf,
} from "./results.ts";
import { createRouter } from "./router.ts";
import { runPlace, runScope } from "./scope.ts";
import { createSlots, needsSlot } from "./slots.ts";
import { createClock, TIMEOUT_GRACE_MS, watchRunTimeout } from "./timeouts.ts";

export const DEFAULT_CONCURRENCY = 4;

export const startRun = (options: RunOptions): RunHandle => {
  const { graph, onEvent } = options;
  const { runId, runDir } = runPlace(options);
  const limits = graph.workflow.limits ?? {};
  const abort = new AbortController();

  const outputs: Record<string, NodeOutput> = {};
  const rounds = new Map<string, number>();
  const sessionIds = new Map<string, string>();
  const running = new Set<string>();
  const summaries = new Map<string, NodeSummary>();
  const queue: Activation[] = [];
  const reasons: string[] = [];
  const stops = createStops(abort.signal);
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

  const ports = createRunPorts({
    graph,
    onEvent,
    mail: options.replay?.mail,
    relay: options.relay,
    slots,
  });
  const holds = createHolds({
    onEvent,
    onChange: () => {
      pump();
    },
  });
  const clock = createClock({ graph, holds, running });
  const human = clock.human(options.human);
  const graceMs = options.timeoutGraceMs ?? TIMEOUT_GRACE_MS;
  const loops = createLoops({
    human,
    bus: ports.bus,
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

  const cancelTimeout = watchRunTimeout({
    timeout: limits.timeout,
    clock: clock.forRun(),
    graceMs,
    expire: reason => {
      stop("timed_out", reason);
      options.calls?.stopAll();
      abort.abort();
      settle();
    },
    leave: () => {
      busy = 0;
      settle();
    },
  });

  const close = async (): Promise<void> => {
    cancelTimeout();
    const worktrees = await closeWorkspace(options.workspace, reasons);
    const nodes = [...summaries.values()];
    const result = runResult({
      runId,
      stopped,
      costUsd: spent,
      nodes,
      reasons,
      worktrees,
      outputs: renderOutputs(graph.workflow.outputs, scope()),
    });
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
  const runChild: ContextDeps["runChild"] = async (child, brief) => {
    await slots.take();
    try {
      // A paused run or child starts its delegated work once it continues.
      await holds.forNode(child.id, child.template).wait("start", abort.signal);
      if (stopped !== null || budgetSpent()) {
        return failure(`not started: ${reasons[0] ?? "the run stopped"}`);
      }
      return await perform({ ...child, input: undefined, brief });
    } finally {
      slots.release();
    }
  };

  const contextDeps: ContextDeps = {
    options,
    runId,
    runDir,
    human,
    outputs,
    rounds,
    sessionIds,
    running,
    holds,
    stops,
    ports,
    slots,
    nodeOf,
    runChild,
    budgetLeft: () =>
      limits.budgetUsd === undefined ? undefined : limits.budgetUsd - spent,
  };

  const execute = createExecute({
    options,
    contextDeps,
    clock,
    graceMs,
    nodeOf,
  });

  /** Runs one activation and records it; routing is the caller's. */
  const perform = async (activation: Activation): Promise<NodeResult> => {
    const { id } = activation;
    const round = (rounds.get(id) ?? 0) + 1;
    rounds.set(id, round);
    running.add(id);
    // A resumed run hands back what an activation did last time.
    const recorded = options.replay?.take(activation) ?? null;
    const type = nodeOf(activation)?.type ?? "control.split";
    if (recorded === null) {
      const agent = graph.agents.get(activation.template ?? id);
      onEvent(startedEvent(activation, type, round, agent));
    }
    const result = stops.ended(id, recorded ?? (await execute(activation)));
    holds.finished(id);
    ports.finished(id);
    running.delete(id);
    outputs[id] = result.output;
    if (result.sessionId !== undefined) sessionIds.set(id, result.sessionId);
    spent += result.usage?.costUsd ?? 0;
    recordRun(summary(id), result);
    if (recorded === null) {
      options.replay?.ran(result);
      onEvent(finishedEvent(id, round, result));
    }
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
      if (stopped !== null || holds.runPaused()) break;
      const activation = queue[index];
      const node = activation && nodeOf(activation);
      if (activation === undefined || node === undefined) {
        queue.splice(index, 1);
        continue;
      }
      if (holds.isHeld(activation.id, activation.template)) {
        index += 1;
        continue;
      }
      const isSession = needsSlot(node);
      // A call spends through its run, so it needs budget as a session does.
      const spends = isSession || node.type === "workflow.call";
      if (spends && budgetSpent()) break;
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

  onEvent(runStartedEvent(graph, runId, options));
  for (const id of graph.entries) queue.push({ id, input: undefined });
  queueMicrotask(pump);

  return {
    runId,
    done,
    interrupt: () => {
      stop("interrupted", "the run was interrupted");
      options.calls?.stopAll();
      abort.abort();
      settle();
    },
    pause: node => holds.pause(node),
    proceed: node => holds.proceed(node),
    stopNode: node => stops.stop(node),
    tell: ports.bus.tell,
    receive: ports.bus.receive,
    notice: (node, text) => {
      ports.bus.notify(node, text);
      onEvent({ type: "link.notice", node, text });
    },
  };
};
