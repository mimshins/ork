/**
 * @file The scheduler: runs a compiled workflow to the end, one round of a node
 *   at a time. Routing, loops, delegation, fan-outs, ports, slots, holds
 *   (ADR-041) and timeouts (ADR-043) each live in their own module.
 */

import { createLoops } from "./escalation.ts";
import {
  type ContextDeps,
  createExecute,
  createFanOut,
  createRunChild,
  forEachOf,
  type StartHooks,
} from "./execute.ts";
import type {
  Activation,
  NodeOutput,
  NodeResult,
  RunHandle,
  RunOptions,
  RunResult,
  RunStatus,
} from "./handle.ts";
import { createHolds, createStops } from "./holds.ts";
import { createRunPorts, runControls } from "./ports.ts";
import {
  closeWorkspace,
  createSummaries,
  finishedEvent,
  createGatherer,
  renderOutputs,
  spendOf,
  recordRun,
  runResult,
  runStartedEvent,
  runTimedOut,
  startedEvent,
} from "./results.ts";
import { createRouter } from "./router.ts";
import { runPlace, runScope } from "./scope.ts";
import { createSlots, needsSlot, spendsBudget } from "./slots.ts";
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
  const spend = spendOf(limits.budgetUsd, options, limits.budgetTokens);
  const running = new Set<string>();
  const { summaries, summary } = createSummaries(options.replay?.earlier);
  const queue: Activation[] = [];
  const reasons: string[] = [];
  const stops = createStops(abort.signal);
  let busy = 0;
  let stopped: RunStatus | null = null;
  let settled = false;
  const { promise: done, resolve: finish } = Promise.withResolvers<RunResult>();

  // Hoisted through `const` closures: a freed slot pumps the queue.
  const slots = createSlots(limits.concurrency ?? DEFAULT_CONCURRENCY, () => {
    pump();
  });
  const scope = () => runScope(options.inputs, outputs, runId);
  const nodeOf = (activation: Pick<Activation, "id" | "template">) =>
    graph.nodes.get(activation.template ?? activation.id)?.node;

  const stop = (status: RunStatus, reason: string): void => {
    if (stopped !== null) return;
    stopped = status;
    reasons.push(reason);
    for (const { id } of queue.splice(0)) summary(id);
  };

  // A route still going when the run stops can't queue what nothing would run.
  const enqueue = (id: string, input?: NodeOutput): void => {
    if (stopped !== null) return;
    router.queued(id);
    queue.push({ id, input });
  };

  const stopping = abort.signal;
  const ports = createRunPorts({ options, runId, slots, scope, stopping });
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
    activate: enqueue,
    fail: reason => {
      stop("failed", reason);
    },
  });
  const router = createRouter({
    graph,
    onEvent,
    scope,
    activate: enqueue,
    takeLoop: loops.take,
    stopped: () => stopped !== null,
    skipped: id => void summary(id),
    failed: reason => void reasons.push(reason),
  });

  const cancelTimeout = watchRunTimeout({
    timeout: limits.timeout,
    clock: clock.forRun(),
    graceMs,
    expire: reason => {
      stop("timed_out", reason);
      options.calls?.stopAll();
      abort.abort(runTimedOut(limits.timeout));
      settle();
    },
    leave: () => {
      busy = 0;
      settle();
    },
  });

  const close = async (): Promise<void> => {
    cancelTimeout();
    locks.end();
    const worktrees = await closeWorkspace(options.workspace, reasons);
    await options.beforeFinish?.();
    const result = runResult({
      runId,
      stopped,
      ...spend.sums(),
      nodes: [...summaries.values()],
      reasons,
      worktrees,
      outputs: renderOutputs(graph.workflow.outputs, scope()),
      failuresHandled: router.handled(),
      unread: ports.bus.unread(),
    });
    onEvent({ type: "run.finished", result });
    finish(result);
  };

  const settle = (): void => {
    if (settled || busy > 0 || queue.length > 0) return;
    if (stopped === null) reasons.push(...router.stuck());
    settled = true;
    void close();
  };

  /** True, and the run stops, once its budget or a quota is spent. */
  const budgetSpent = (): boolean => {
    const out = spend.spentOut();
    if (out === null) return false;
    stop(out.status, out.reason);
    return true;
  };

  const starts: StartHooks = {
    slots,
    holds,
    signal: abort.signal,
    reasons,
    isStopped: () => stopped !== null,
    budgetSpent,
    perform: activation => perform(activation),
  };

  const contextDeps: ContextDeps = {
    options,
    runId,
    runDir,
    human,
    outputs,
    sessionIds,
    running,
    holds,
    stops,
    ports,
    slots,
    nodeOf,
    runChild: createRunChild(starts),
    spend,
    summary,
  };

  const { execute, locks } = createExecute({
    options,
    contextDeps,
    clock,
    graceMs,
    nodeOf,
    fanOut: createFanOut({ ...starts, options, stops, scope, nodeOf, loops }),
  });

  const gather = createGatherer(outputs, options.replay, nodeOf);
  /** Runs one activation and records it; routing is the caller's. */
  const perform = async (activation: Activation): Promise<NodeResult> => {
    const { id } = activation;
    const round = activation.round ?? (rounds.get(id) ?? 0) + 1;
    rounds.set(id, round);
    clock.enter(id);
    // A resumed run hands back what an activation did last time.
    const recorded = options.replay?.take(activation) ?? null;
    const type = nodeOf(activation)?.type ?? "control.split";
    if (recorded === null) {
      const agent = graph.agents.get(activation.template ?? id);
      onEvent(startedEvent(activation, type, round, agent));
    }
    const result = gather(
      activation,
      spend.count(
        id,
        stops.ended(id, recorded ?? (await execute(activation, round))),
        recorded !== null,
      ),
    );
    // A limit cut it off: no edge acts on its failure, and a resume goes on.
    if (result.limited !== undefined)
      stop(result.stopsAs ?? "quota_exhausted", result.limited);
    spend.settled(id);
    holds.finished(id);
    ports.finished(id);
    clock.leave(id);
    outputs[id] = result.output;
    if (result.sessionId !== undefined) sessionIds.set(id, result.sessionId);
    recordRun(summary(id), result);
    if (recorded === null) {
      options.replay?.ran(result);
      onEvent(finishedEvent(id, round, result));
      ports.fireRules(activation, result);
    }
    return result;
  };

  const run = async (activation: Activation, isSession: boolean) => {
    const result = await perform(activation);
    if (isSession) slots.release();
    await router.finished(activation.id, result);
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
      const { id, template } = activation;
      // A node's next round waits for the one it is running to finish.
      if (holds.isHeld(id, template) || running.has(id)) {
        index += 1;
        continue;
      }
      // A fanned node runs no session itself; its items each take a slot.
      const isSession = needsSlot(node) && forEachOf(node) === undefined;
      if (spendsBudget(node) && budgetSpent()) break;
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
  for (const id of graph.entries) enqueue(id);
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
    ...runControls(ports, holds, stops, onEvent),
  };
};
