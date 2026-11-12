/**
 * @file What a node's card says beyond where it sits: its status, model, tokens
 *   and cost, and its accessible name, which says all of that in words, in the
 *   order the card shows it so the name holds what is on screen (WCAG 2.5.3).
 */

import { type Status, statusWord } from "../components/status-badge.tsx";

export type NodeFacts = {
  status: Status;
  model?: string | undefined;
  /** Counted tokens: input, output and cache write (RFC-015). */
  tokens?: number | undefined;
  /** Its sessions ran on a driver that reports no dollars. */
  unpriced?: boolean | undefined;
  costUsd?: number | undefined;
  /** Says this in place of the status's word: the builder's problems. */
  word?: string | undefined;
  /** A node with `forEach`: how far its items have got, `3 of 8, 1 failed`. */
  progress?: string | undefined;
  /** The `ork` command that shows this node, for its tooltip. */
  cli?: string | undefined;
  /** What the task that started this node called it; named second. */
  description?: string | undefined;
};

const WORDS: Readonly<Record<string, string>> = {
  "agent.leader": "leader",
  "agent.worker": "worker",
  "agent.subagent": "sub-agent",
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

/** `950`, `12.3k`, `4.5M`: one decimal, rounded up at a unit's edge. */
export const formatTokens = (tokens: number): string => {
  if (tokens < 1000) return String(tokens);
  const thousands = Math.round(tokens / 100) / 10;
  return thousands < 1000
    ? `${thousands.toFixed(1)}k`
    : `${(Math.round(tokens / 100_000) / 10).toFixed(1)}M`;
};

/** A cap in tokens: `50k`, `2M`, with no `.0`. */
export const formatTokenCap = (tokens: number): string =>
  formatTokens(tokens).replace(/\.0(?=[kM]$)/u, "");

/** A sum that misses some sessions reads as a floor: `≥ $1.20`. */
export const atLeast = (text: string, partial: boolean): string =>
  partial ? `≥ ${text}` : text;

const pad = (part: number): string => String(part).padStart(2, "0");

/** `4:02`, or `1:04:02` past the hour. */
export const formatElapsed = (ms: number): string => {
  const seconds = Math.max(Math.floor(ms / 1000), 0);
  const minutes = Math.floor(seconds / 60);
  const end = `${pad(minutes % 60)}:${pad(seconds % 60)}`;
  return minutes < 60
    ? `${String(minutes)}:${pad(seconds % 60)}`
    : `${String(Math.floor(minutes / 60))}:${end}`;
};

export const nodeName = (id: string, type: string, facts: NodeFacts): string =>
  [
    id,
    ...(facts.description === undefined || facts.description === ""
      ? []
      : [facts.description]),
    facts.word ?? statusWord(facts.status),
    ...(facts.progress === undefined ? [] : [facts.progress]),
    ...(facts.costUsd === undefined ? [] : [formatCost(facts.costUsd)]),
    ...(facts.tokens === undefined
      ? []
      : [`${formatTokens(facts.tokens)} tokens`]),
    ...(facts.model === undefined ? [] : [facts.model]),
    ...(facts.unpriced === true ? ["no price"] : []),
    typeWord(type),
  ].join(", ");
