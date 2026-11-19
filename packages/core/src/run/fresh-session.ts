/**
 * @file Fresh sessions for an owned builder's next task (the
 *   `sessions.freshOver` rule, specs/scheduler/fresh-sessions.md): each node's
 *   session in this process, how its last activation ended and how large its
 *   context was, and the decision, by code alone, to start a delegated worker's
 *   next task fresh instead of resuming, with a note of its earlier tasks.
 */

import type { Node, Workflow } from "@krapht/ork-schema";

import { resumeOf } from "./context.ts";
import { type EndKind, endOf } from "./ended.ts";
import type { Activation } from "./handle.ts";
import { type EarlierTask, earlierTask, handoverNote } from "./handover.ts";
import type { NodeResult } from "./types.ts";

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

/**
 * Each node's session in this process and its last end, and the decision for
 * the activation each node runs now (a node runs one activation at a time).
 */
export const createSessions = (
  workflow: Workflow,
  nodeOf: (activation: Activation) => Node | undefined,
) => {
  const ids = new Map<string, string>();
  const ends = new Map<string, LastEnd>();
  const now = new Map<string, FreshStart>();
  const tasks = new Map<string, EarlierTask[]>();
  return {
    ids,
    /** Decides `activation`'s start once, and keeps it for its context. */
    decide: (activation: Activation): FreshStart | undefined => {
      const { id } = activation;
      const fresh = freshStart({
        node: nodeOf(activation),
        delegated: activation.brief !== undefined,
        sessionId: ids.get(id),
        last: ends.get(id),
        freshOver: workflow.rules?.sessions?.freshOver,
      });
      if (fresh === undefined) now.delete(id);
      else now.set(id, fresh);
      return fresh;
    },
    /** Whether the activation `id` runs now starts fresh. */
    isFresh: (id: string): boolean => now.has(id),
    /** The note of earlier tasks for the activation `id` starting fresh now. */
    handover: (id: string): string | undefined =>
      now.has(id) ? handoverNote(tasks.get(id) ?? []) : undefined,
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
