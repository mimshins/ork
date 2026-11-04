/**
 * @file What a node's card says beyond where it sits: its status, model, tokens
 *   and cost, and its accessible name, which says all of that in words, in the
 *   order the card shows it so the name holds what is on screen (WCAG 2.5.3).
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
  "mcp.call": "MCP call",
};

export const typeWord = (type: string): string =>
  WORDS[type] ??
  (type.startsWith("tool.") ? `${type.slice("tool.".length)} tool` : type);

/** Below this, four decimals would still read as nothing. */
const SMALLEST_COST = 0.000_05;

/**
 * `$0.0312` for small sums, `$12.34` once cents are enough. `among` is the rest
 * of its column: the numbers of a table share one precision, so they line up.
 */
export const formatCost = (
  costUsd: number,
  among: readonly number[] = [costUsd],
): string => {
  if (!Number.isFinite(costUsd)) return "–";
  const size = Math.abs(costUsd);
  if (size !== 0 && size < SMALLEST_COST) {
    return costUsd > 0 ? "<$0.0001" : "$0.00";
  }
  // By what it reads as: 9.99996 shows as 10, so it needs no more than cents.
  const small = among.some(cost => {
    const shown = Math.abs(Number(cost.toFixed(4)));
    return shown !== 0 && shown < 10;
  });
  return `${costUsd < 0 ? "-" : ""}$${size.toFixed(small ? 4 : 2)}`;
};

export const formatTokens = (tokens: number): string =>
  tokens < 1000 ? String(tokens) : `${(tokens / 1000).toFixed(1)}k`;

/** A model's name on a card, which has little room: `claude-` says nothing. */
export const shortModel = (model: string): string =>
  model.replace(/^claude-/u, "");

export const nodeName = (id: string, type: string, facts: NodeFacts): string =>
  [
    id,
    statusWord(facts.status),
    ...(facts.costUsd === undefined ? [] : [formatCost(facts.costUsd)]),
    ...(facts.tokens === undefined
      ? []
      : [`${formatTokens(facts.tokens)} tokens`]),
    ...(facts.model === undefined ? [] : [facts.model]),
    typeWord(type),
  ].join(", ");
