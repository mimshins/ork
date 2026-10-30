/**
 * @file Small helpers for the scheduler's results: pass-through and failure
 *   results, run-summary entries, and `node.finished` events.
 */

import type { NodeOutput, NodeResult, NodeSummary, RunEvent } from "./types.ts";

/** Control nodes pass their input through; a join's input is its output. */
export const passThrough = (input: NodeOutput | undefined): NodeResult => ({
  output: input ?? {},
  ok: true,
});

export const recordRun = (entry: NodeSummary, result: NodeResult): void => {
  entry.runs += 1;
  entry.ok = result.ok;
  entry.output = result.output;
  entry.costUsd += result.usage?.costUsd ?? 0;
  if (result.error === undefined) delete entry.error;
  else entry.error = result.error;
};

export const finishedEvent = (
  id: string,
  round: number,
  result: NodeResult,
): RunEvent => {
  const event: RunEvent = {
    type: "node.finished",
    id,
    round,
    ok: result.ok,
    output: result.output,
  };
  if (result.usage !== undefined) event.usage = result.usage;
  if (result.error !== undefined) event.error = result.error;
  return event;
};

export const failure = (error: string): NodeResult => ({
  output: { status: "fail", summary: error },
  ok: false,
  error,
});

/** The node's entry in the run summary, created on first use. */
export const summaryOf = (
  summaries: Map<string, NodeSummary>,
  id: string,
): NodeSummary => {
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
