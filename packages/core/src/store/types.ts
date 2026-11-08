/**
 * @file The event store's port (specs/event-store.md): every run's record and
 *   its append-only events, read back by `ork ps`, `logs`, `tree` and the
 *   server.
 */

import type { ProjectRecord } from "../project/place.ts";
import type { RunEvent, RunStatus } from "../run/types.ts";
import type { DecisionChoice, PlanLimit } from "../runtime/types.ts";
import type { DraftStore } from "./drafts.ts";
import type {
  FeedbackItem,
  FeedbackRecord,
  FeedbackStatus,
  FeedbackStore,
} from "./feedback-types.ts";
import type { TriggerStore } from "./trigger-types.ts";

export type { FeedbackItem, FeedbackRecord, FeedbackStatus, FeedbackStore };

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
  /**
   * When that process started, as the system tells it (`linux:<boot>:<ticks>`
   * or `ps:<seconds>`): a live process with the id but another start is not the
   * run's. Absent for runs recorded before it was, and where it can't be read.
   */
  processStart?: string;
  startedAt: string;
  finishedAt?: string;
  costUsd: number;
  /** The run whose `workflow.call` started this one. */
  parent?: string;
  /** How many calls deep it is; 0 for a run the user started. */
  depth: number;
  /**
   * A finished run's count of skipped nodes and of failures an edge handled,
   * from its `run.finished` result; absent while it runs, and for runs recorded
   * before they were counted.
   */
  skipped?: number;
  failuresHandled?: number;
};

export type NewRun = Pick<RunRecord, "id" | "workflow" | "file" | "project"> & {
  parent?: string;
};

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

/**
 * Who answered: the run's own terminal, `ork decide`, the UI (`ork ui`), or the
 * asker's owner, a leader that takes its children's questions (ADR-063).
 */
export type AnsweredBy = "terminal" | "decide" | "ui" | "owner";

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
  /**
   * What to read to answer, masked; absent when the gate has none, and on
   * records from before documents. Never in `decision.opened`.
   */
  document?: string;
  openedAt: string;
  status: "open" | "answered" | "withdrawn";
  answer?: string;
  answeredBy?: AnsweredBy;
  answeredAt?: string;
  /**
   * What the person said with their answer, masked; absent when they said
   * nothing, and on records from before notes. An owner's answer's note is its
   * reason.
   */
  note?: string;
  /**
   * The leader that took the question first (ADR-063): it answered
   * (`answeredBy: owner`), or passed it on, its note in `context`.
   */
  owner?: string;
};

export type NewDecision = Pick<
  DecisionRecord,
  "id" | "runId" | "node" | "kind" | "question" | "options"
> &
  Partial<
    Pick<DecisionRecord, "recommended" | "context" | "document" | "owner">
  >;

/** What another process may ask a live run to do. */
export type RunCommand =
  /** `ork stop`, `ork pause`, `ork continue`: of the run, or of one node. */
  | { kind: "stop" | "pause" | "continue"; node?: string }
  /** `ork chat`: a message from the user to a node's session. */
  | { kind: "message"; node: string; body: string }
  /** A message from a linked node of another run; `from` is `<run>/<node>`. */
  | { kind: "relay"; node: string; from: string; body: string }
  /** `ork send`: from a program in the tool node `from` of this run. */
  | { kind: "script"; node: string; from: string; body: string }
  /** Ork's own line for a node's live session: a link was made or ended. */
  | { kind: "notice"; node: string; body: string };

/** One side of a link: a node of a run. */
export type LinkEnd = { run: string; node: string };

/** Two nodes of different runs that may write to each other (RFC-003). */
export type LinkRecord = {
  id: number;
  a: LinkEnd;
  b: LinkEnd;
  /** Sent so far, both ways. */
  messages: number;
  /** Reaching it asks the user whether to go on. */
  maxMessages: number;
  createdAt: string;
  /** Absent while the link is live. */
  endedAt?: string;
};

export type LinkStore = {
  addLink: (a: LinkEnd, b: LinkEnd, maxMessages: number) => LinkRecord;
  link: (id: number) => LinkRecord | undefined;
  /** Oldest first: one run's, and only live ones, when asked. */
  links: (filter?: { run?: string; live?: boolean }) => LinkRecord[];
  countMessage: (id: number) => void;
  extendLink: (id: number, by: number) => void;
  /** False when it had already ended. */
  endLink: (id: number) => boolean;
};

export type DecisionStore = {
  /** Opens a decision; its text is masked like events. */
  openDecision: (decision: NewDecision) => DecisionRecord;
  /**
   * Answers an open decision, with the person's note if they gave one (blank is
   * none; it is masked); false when it was already closed (first wins).
   */
  answerDecision: (
    id: string,
    answer: string,
    by: AnsweredBy,
    note?: string,
  ) => boolean;
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
  /**
   * Queues a program's message unless its node has sent `atMost` in this run,
   * counted and written as one step, so a burst cannot pass it.
   */
  scriptCommand: (
    runId: string,
    command: Extract<RunCommand, { kind: "script" }>,
    atMost: number,
  ) => boolean;
  /** The run's unhandled commands, marked handled. */
  takeCommands: (runId: string) => RunCommand[];
};

export type ProjectStore = {
  /** Registered projects, by id. */
  projects: () => ProjectRecord[];
  /** Registers a project; its id and root must be new. */
  addProject: (project: Omit<ProjectRecord, "registeredAt">) => ProjectRecord;
  /** Forgets a project (its files stay); false when there is no such id. */
  forgetProject: (id: string) => boolean;
  /**
   * Records a project's files in a new place (`ork migrate`), or the project at
   * a new root (`ork projects move`), and its runs with it; false when there is
   * no such id.
   */
  moveProject: (
    id: string,
    place: Pick<ProjectRecord, "mode" | "dir"> & { root?: string },
  ) => boolean;
};

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

export type UsageFilter = {
  project?: string;
  workflow?: string;
  /** ISO times: `since` included, `until` not. */
  since?: string;
  until?: string;
};

export type UsageStore = {
  /** The sessions in the filter, oldest first. */
  usage: (filter?: UsageFilter) => UsageRow[];
  /** What was spent since an ISO time, in one project or all. */
  spentSince: (since: string, project?: string) => number;
  /** Each of a plan's limits, as last reported. */
  planLimits: () => PlanLimit[];
  /** Forgets them, for one that has lifted early; a session reports them anew. */
  clearPlanLimits: () => void;
  /** When a run's last event was written; `undefined` with no events. */
  lastEventAt: (runId: string) => string | undefined;
  /** Forgets a run and its transcript, but not its spending; false if it's live. */
  deleteRun: (runId: string) => boolean;
  /** Gives freed space back to the disk; why it could not, or `null`. */
  compact: () => string | null;
};

export type EventStore = DecisionStore &
  LinkStore &
  FeedbackStore &
  ProjectStore &
  UsageStore &
  DraftStore &
  TriggerStore & {
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
    /** The nodes a run's events are about, in the order they first appear. */
    nodes: (runId: string) => string[];
    close: () => void;
  };
