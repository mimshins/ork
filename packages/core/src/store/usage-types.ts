/**
 * @file The usage ledger's rows (ADR-046): a Claude session's spend, the CPU
 *   one of Ork's tool commands used, and the filter reports read them by.
 */

/** One Claude session's spend (ADR-046); it outlives its run's transcript. */
export type UsageRow = {
  runId: string;
  /** The `session.finished` event it came from. */
  seq: number;
  /** When the session finished. */
  at: string;
  project: string;
  workflow: string;
  node: string;
  /** For a spawned worker, the declared node it is an instance of. */
  template?: string;
  model?: string;
  driver?: string;
  /** `chat`: `ork chat` resumed the session after the node finished. */
  kind: "node" | "chat";
  /** The node's round: above 1 when a loop sent the work back. */
  round: number;
  /** The session errored, or reported `fail`. */
  failed: boolean;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  turns: number;
  durationMs: number;
};

/** The CPU one of Ork's tool commands used, children included. */
export type ToolCpuRow = Pick<
  UsageRow,
  "runId" | "seq" | "at" | "project" | "workflow" | "node" | "template"
> & { userMs: number; systemMs: number };

export type UsageFilter = {
  project?: string;
  workflow?: string;
  /** ISO times: `since` included, `until` not. */
  since?: string;
  until?: string;
};
