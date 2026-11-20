/**
 * @file Fresh sessions for an owned builder's next task (the
 *   `sessions.freshOver` rule, specs/scheduler/fresh-sessions.md): each node's
 *   session in this process, how its last activation ended and how large its
 *   context was, and the decision, by code alone, to start a delegated worker's
 *   next task fresh instead of resuming, with a note of its earlier tasks. Also
 *   the driver each session started on: a session another driver would resume
 *   starts fresh instead (a changed driver, in the same spec).
 */

import {
  type Driver,
  isClaudeNode,
  type Node,
  type Workflow,
} from "@krapht/ork-schema";

import { modelOf } from "./brief.ts";
import { resumeOf } from "./context.ts";
import { modelDriver, namedDriver, sessionDriver } from "./driver.ts";
import { type EndKind, endOf } from "./ended.ts";
import type { Activation, RunOptions } from "./handle.ts";
import { type EarlierTask, earlierTask, handoverNote } from "./handover.ts";
import type { NodeOutput, NodeResult, RunEvent } from "./types.ts";

/** Why a delegated activation starts fresh: its last context and the rule's. */
export type FreshStart = { contextTokens: number; over: number };

/** How a node's last activation in this process ended. */
export type LastEnd = { kind: EndKind; contextTokens?: number };

/**
 * Whether this activation starts a fresh session instead of resuming: an owner
 * delegated it, the node is a worker that resumes and has a session to resume,
 * its last activation ended `done`, and that session's context was over the
 * rule's `freshOver`. Undefined when any fails, the rule is `never` or unset.
 */
export const freshStart = (facts: {
  node: Node | undefined;
  delegated: boolean;
  sessionId: string | undefined;
  last: LastEnd | undefined;
  freshOver: number | "never" | undefined;
}): FreshStart | undefined => {
  const { node, last, freshOver } = facts;
  if (typeof freshOver !== "number" || !facts.delegated) return undefined;
  if (node?.type !== "agent.worker") return undefined;
  if (resumeOf(node, facts.sessionId) === undefined) return undefined;
  if (last?.kind !== "done" || last.contextTokens === undefined)
    return undefined;
  return last.contextTokens > freshOver
    ? { contextTokens: last.contextTokens, over: freshOver }
    : undefined;
};

/** A session's driver then and the activation's now, when they differ. */
export type DriverChange = { from: Driver; to: Driver };

/** How an activation starts: the session it resumes, or why it starts fresh. */
export type StartDecision = {
  resume?: string;
  fresh?: FreshStart;
  driverChanged?: DriverChange;
};

/**
 * The driver a Claude node's session would start on now, as its plan resolves
 * it: the driver its rendered model names, else `--driver`, else the node's or
 * the workflow's, else the one ready when the run started. `undefined` when it
 * can't be told (no session node, a model that fails, nothing applies).
 */
export const activationDriver = (
  workflow: Workflow,
  node: Node | undefined,
  run: {
    inputs: Parameters<typeof modelOf>[2]["inputs"];
    outputs: Record<string, NodeOutput>;
    item?: Activation["item"];
    override?: Driver | undefined;
    ready?: Driver | undefined;
  },
): Driver | undefined => {
  if (node === undefined || !isClaudeNode(node)) return undefined;
  const models = modelOf(node, workflow.defaults ?? {}, {
    inputs: run.inputs,
    outputs: run.outputs,
    ...(run.item === undefined ? {} : { item: run.item }),
  });
  if (!models.ok) return undefined;
  return sessionDriver({
    pinned:
      models.model === undefined ? undefined : modelDriver(models.model).driver,
    override: run.override,
    named: namedDriver(node, workflow),
    ready: run.ready,
  });
};

/**
 * The driver each recorded session started on, by session id, for `ork resume`;
 * a run recorded before drivers were has none.
 */
export const sessionDrivers = (
  events: readonly RunEvent[],
): Map<string, Driver> =>
  new Map(
    events.flatMap(event =>
      event.type === "node.event" &&
      event.event.type === "session.started" &&
      event.event.driver !== undefined &&
      event.event.fork !== true
        ? [[event.event.sessionId, event.event.driver] as const]
        : [],
    ),
  );

/**
 * Each node's session in this process and its last end, the driver each session
 * started on, and the decision for the activation each node runs now (a node
 * runs one activation at a time). `options` gives a resumed run's cut and
 * earlier sessions and their drivers, and with `outputs` the driver each
 * activation takes now.
 */
export const createSessions = (
  workflow: Workflow,
  nodeOf: (activation: Activation) => Node | undefined,
  run: {
    options?: Pick<RunOptions, "replay" | "inputs" | "settings">;
    outputs?: Record<string, NodeOutput>;
  } = {},
) => {
  const replay = run.options?.replay;
  const driverOf = (activation: Activation): Driver | undefined =>
    run.options === undefined
      ? undefined
      : activationDriver(workflow, nodeOf(activation), {
          inputs: run.options.inputs,
          outputs: run.outputs ?? {},
          item: activation.item,
          override: run.options.settings?.driver,
          ready: run.options.settings?.readyDriver,
        });
  const ids = new Map<string, string>();
  /** The driver each session started on, by session id. */
  const drivers = new Map<string, Driver>();
  const ends = new Map<string, LastEnd>();
  const now = new Map<string, StartDecision>();
  const tasks = new Map<string, EarlierTask[]>();
  /** The two drivers when `resume` would continue on another one. */
  const changeOf = (
    activation: Activation,
    resume: string | undefined,
  ): DriverChange | undefined => {
    if (resume === undefined) return undefined;
    // Not known (a run recorded before drivers were): it resumes as before.
    const from = drivers.get(resume) ?? replay?.sessionDriver?.(resume);
    const to = from === undefined ? undefined : driverOf(activation);
    return from === undefined || to === undefined || from === to
      ? undefined
      : { from, to };
  };
  return {
    ids,
    /** A session of this process started on `driver`. */
    started: (sessionId: string, driver: Driver): void => {
      drivers.set(sessionId, driver);
    },
    /** Decides `activation`'s start once, and keeps it for its context. */
    decide: (activation: Activation): StartDecision => {
      const { id } = activation;
      const node = nodeOf(activation);
      const fresh = freshStart({
        node,
        delegated: activation.brief !== undefined,
        sessionId: ids.get(id),
        last: ends.get(id),
        freshOver: workflow.rules?.sessions?.freshOver,
      });
      // A cut-off session continues once; a delegated worker over the rule
      // starts its task fresh.
      const resume =
        replay?.cutOff?.(activation) ??
        (fresh === undefined
          ? resumeOf(node, ids.get(id) ?? replay?.previousSession?.(activation))
          : undefined);
      // A session belongs to its driver: another can't resume it.
      const driverChanged = changeOf(activation, resume);
      const decision: StartDecision = {};
      if (fresh !== undefined) decision.fresh = fresh;
      if (driverChanged !== undefined) decision.driverChanged = driverChanged;
      else if (resume !== undefined) decision.resume = resume;
      now.set(id, decision);
      return decision;
    },
    /** The session the activation `id` runs now resumes, if it does. */
    resume: (id: string): string | undefined => now.get(id)?.resume,
    /** The note of earlier tasks for the activation `id` starting fresh now. */
    handover: (id: string): string | undefined => {
      const decision = now.get(id);
      return decision?.fresh === undefined &&
        decision?.driverChanged === undefined
        ? undefined
        : handoverNote(tasks.get(id) ?? []);
    },
    /** An activation ended; a replayed one leaves no figures to decide by. */
    ended: (
      activation: Activation,
      result: NodeResult,
      replayed: boolean,
    ): void => {
      const { id } = activation;
      now.delete(id);
      if (result.sessionId !== undefined) ids.set(id, result.sessionId);
      if (replayed) return;
      if (activation.brief !== undefined) {
        tasks.set(id, [
          ...(tasks.get(id) ?? []),
          earlierTask(activation, result),
        ]);
      }
      const contextTokens = result.usage?.contextTokens;
      const kind = endOf(result).kind;
      ends.set(
        id,
        contextTokens === undefined ? { kind } : { kind, contextTokens },
      );
    },
  };
};
