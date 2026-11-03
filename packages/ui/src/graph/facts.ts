/**
 * @file What a node's card says beyond where it sits: its status, model, tokens
 *   and cost, and its accessible name, which says all of that in words.
 */

import { type Status, statusWord } from "../components/status-badge.tsx";

export type NodeFacts = {
  status: Status;
  model?: string | undefined;
  tokens?: number | undefined;
  costUsd?: number | undefined;
  /** The `ork` command that shows this node, for its tooltip. */
  cli?: string | undefined;
};

const WORDS: Readonly<Record<string, string>> = {
  "claude.leader": "leader",
  "claude.worker": "worker",
  "claude.subagent": "sub-agent",
  "control.split": "split",
  "control.join": "join",
  "control.router": "router",
  "human.gate": "gate",
  "workflow.call": "workflow call",
};

export const typeWord = (type: string): string =>
  WORDS[type] ??
  (type.startsWith("tool.") ? `${type.slice("tool.".length)} tool` : type);

export const formatCost = (costUsd: number): string => `$${costUsd.toFixed(4)}`;

export const formatTokens = (tokens: number): string =>
  tokens < 1000 ? String(tokens) : `${(tokens / 1000).toFixed(1)}k`;

export const nodeName = (id: string, type: string, facts: NodeFacts): string =>
  [
    id,
    typeWord(type),
    statusWord(facts.status),
    ...(facts.model === undefined ? [] : [facts.model]),
    ...(facts.tokens === undefined ? [] : [`${String(facts.tokens)} tokens`]),
    ...(facts.costUsd === undefined ? [] : [formatCost(facts.costUsd)]),
  ].join(", ");
