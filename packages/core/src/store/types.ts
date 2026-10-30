/**
 * @file The event store's port (specs/event-store.md): every run's record and
 *   its append-only events, read back by `ork ps`, `logs` and `tree` and, in
 *   M2, by the server.
 */

import type { RunEvent, RunStatus } from "../run/types.ts";
import type { DecisionChoice } from "../runtime/types.ts";

/** A run's status in the store: `running` until `run.finished` is written. */
export type StoredRunStatus = RunStatus | "running";

export type RunRecord = {
  id: string;
  workflow: string;
  /** The workflow file, absolute. */
  file: string;
  /** The project root the run started in, absolute. */
  project: string;
  status: StoredRunStatus;
  /** The process that runs it; a `running` run whose process is gone crashed. */
  pid: number;
  startedAt: string;
  finishedAt?: string;
  costUsd: number;
};

export type NewRun = Pick<RunRecord, "id" | "workflow" | "file" | "project">;

export type StoredEvent = {
  runId: string;
  /** 1, 2, 3, … within the run. */
  seq: number;
  /** ISO time it was written. */
  at: string;
  event: RunEvent;
};

/**
 * A question the run waits on: `ask_user`, a gate, a loop, or a tool
 * permission.
 */
export type DecisionKind = "question" | "permission";

/** Who answered: the run's own terminal, `ork decide`, or nobody (withdrawn). */
export type AnsweredBy = "terminal" | "decide";

export type DecisionRecord = {
  /** `<run>-<n>`. */
  id: string;
  runId: string;
  node: string;
  kind: DecisionKind;
  question: string;
  options: DecisionChoice[];
  recommended?: string;
  context?: string;
  openedAt: string;
  status: "open" | "answered" | "withdrawn";
  answer?: string;
  answeredBy?: AnsweredBy;
  answeredAt?: string;
};

export type NewDecision = Pick<
  DecisionRecord,
  "id" | "runId" | "node" | "kind" | "question" | "options"
> &
  Partial<Pick<DecisionRecord, "recommended" | "context">>;

/** What another process may ask a live run to do. */
export type RunCommand =
  | { kind: "stop" }
  /** `ork chat`: a message from the user to a node's session. */
  | { kind: "message"; node: string; body: string };

export type DecisionStore = {
  /** Opens a decision; its text is masked like events. */
  openDecision: (decision: NewDecision) => DecisionRecord;
  /** Answers an open decision; false when it was already closed (first wins). */
  answerDecision: (id: string, answer: string, by: AnsweredBy) => boolean;
  /** Closes an open decision unanswered, e.g. when a gate's timeout answers it. */
  withdrawDecision: (id: string) => void;
  decision: (id: string) => DecisionRecord | undefined;
  /** Decisions, oldest first: one run's, or one project's, and by status. */
  decisions: (filter: {
    runId?: string;
    project?: string;
    status?: DecisionRecord["status"];
  }) => DecisionRecord[];
  /** Queues a command for a live run; a message's body is masked. */
  command: (runId: string, command: RunCommand) => void;
  /** The run's unhandled commands, marked handled. */
  takeCommands: (runId: string) => RunCommand[];
};

export type EventStore = DecisionStore & {
  /** Records a new run as `running` in this process. */
  begin: (run: NewRun) => RunRecord;
  /** Marks a stored run `running` again, in this process (`ork resume`). */
  reopen: (runId: string) => void;
  /** Appends one event; `run.finished` also settles the run's record. */
  append: (runId: string, event: RunEvent) => StoredEvent;
  /** Runs, newest first; only one project's when given. */
  runs: (filter?: { project?: string; limit?: number }) => RunRecord[];
  /** The runs whose id starts with `prefix` (the whole id matches one). */
  lookup: (prefix: string) => RunRecord[];
  /** A run's events in order, after `seq` when given. */
  events: (runId: string, after?: number) => StoredEvent[];
  close: () => void;
};
