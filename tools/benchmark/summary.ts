/**
 * @file A benchmark's numbers from a run tree: cost and tokens in total and by
 *   node, turns, working and waiting minutes, decisions, the agents its nodes
 *   used, the commits its tool nodes printed, and one CSV row per session.
 */

import { type Json, r1, r4, rec, text } from "./json.ts";
import { activations, WAITS, workingMs } from "./timing.ts";
import type { StoredEvent, Tree, Usage } from "./tree.ts";

type Tokens = {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
};

const tokensOf = (rows: readonly Usage[]): Tokens => ({
  input_tokens: rows.reduce((s, u) => s + u.inputTokens, 0),
  output_tokens: rows.reduce((s, u) => s + u.outputTokens, 0),
  cache_read_tokens: rows.reduce((s, u) => s + u.cacheReadTokens, 0),
  cache_write_tokens: rows.reduce((s, u) => s + u.cacheWriteTokens, 0),
});

const minutes = (ms: number): number => r1(ms / 60_000);

const nodeTotals = (rows: readonly Usage[]) =>
  Object.assign(
    {
      model: [...new Set(rows.map(r => r.model))].join(","),
      sessions: rows.length,
      failed: rows.filter(r => r.failed).length,
      turns: rows.reduce((s, r) => s + r.turns, 0),
    },
    tokensOf(rows),
    { cost_usd: r4(rows.reduce((s, r) => s + r.costUsd, 0)) },
  );

/** The agents the tree's nodes ran as, once each, by where they live. */
export const agentsOf = (events: readonly StoredEvent[]): Json[] => {
  const agents = new Map<string, Json>();
  for (const e of events) {
    const agent = rec(e.data["agent"]);
    const where = text(agent["where"]);
    if (e.type === "node.started" && where !== undefined) {
      agents.set(where, agent);
    }
  }
  return [...agents.values()];
};

/** Commits a run's tool nodes made, from what `git commit` printed. */
export const resultCommits = (events: readonly StoredEvent[]): string[] => {
  const shas = new Set<string>();
  for (const e of events) {
    if (e.type !== "node.finished") continue;
    const output = rec(e.data["output"]);
    const printed = [text(output["stdout"]), text(output["stderr"])].join("\n");
    for (const m of printed.matchAll(/^\[[^\]\n]* ([0-9a-f]{7,40})\] /gmu)) {
      if (m[1] !== undefined) shas.add(m[1]);
    }
  }
  return [...shas];
};

/** The numbers of `summary.json`. */
export const summarize = (tree: Tree) => {
  const ends = tree.runs.map(r =>
    r.finishedAt === null ? 0 : Date.parse(r.finishedAt),
  );
  const last = Math.max(...tree.events.map(e => e.at), ...ends);
  const first = Math.min(...tree.runs.map(r => Date.parse(r.startedAt)));
  const acts = activations(tree.events, last);
  const working = workingMs(acts, tree.decisions, last);
  const total = tokensOf(tree.usage);
  const byNode = new Map<string, Usage[]>();
  for (const u of tree.usage) {
    const key = `${u.workflow}.${u.node}`;
    byNode.set(key, [...(byNode.get(key) ?? []), u]);
  }
  return {
    run: tree.runs[0]?.id ?? "",
    status: tree.runs[0]?.status ?? "",
    runs: tree.runs.map(r => ({
      id: r.id,
      workflow: r.workflow,
      parent: r.parent,
      status: r.status,
      started: r.startedAt,
      finished: r.finishedAt,
      cost_usd: r4(r.costUsd),
    })),
    started: new Date(first).toISOString(),
    finished: new Date(last).toISOString(),
    cost_usd: r4(tree.usage.reduce((s, u) => s + u.costUsd, 0)),
    tokens: Object.assign({}, total, {
      all_tokens: Object.values(total).reduce((s, v) => s + v, 0),
    }),
    turns: tree.usage.reduce((s, u) => s + u.turns, 0),
    sessions: tree.usage.length,
    failed_sessions: tree.usage.filter(u => u.failed).length,
    minutes: {
      working: minutes(working),
      waiting_on_maintainer: minutes(last - first - working),
      wall: minutes(last - first),
    },
    decisions: tree.decisions.length,
    permission_requests: tree.decisions.filter(d => d.kind === "permission")
      .length,
    by_node: Object.fromEntries(
      [...byNode].map(([key, rows]) => [key, nodeTotals(rows)]),
    ),
    activations: acts
      .filter(a => !WAITS.has(a.type))
      .map(a => ({
        run: a.run,
        node: a.node,
        round: a.round,
        agent: a.agent ?? null,
        owner: a.owner ?? null,
        ok: a.ok ?? null,
        start: new Date(a.start).toISOString(),
        minutes: minutes(a.end - a.start),
      })),
    agents: agentsOf(tree.events),
  };
};

const USAGE_COLUMNS = [
  "run",
  "workflow",
  "node",
  "model",
  "driver",
  "kind",
  "round",
  "failed",
  "costUsd",
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "turns",
  "durationMs",
  "at",
] as const;

/** One row per Claude session. */
export const usageCsv = (usage: readonly Usage[]): string =>
  `${[
    USAGE_COLUMNS.join(","),
    ...usage.map(u =>
      USAGE_COLUMNS.map(c => (c === "failed" ? Number(u.failed) : u[c])).join(
        ",",
      ),
    ),
  ].join("\n")}\n`;
