/**
 * @file The HTTP API's contract (ADR-039, specs/server/api.md): each route's
 *   method and path, the Zod schemas of its query and body, and the type of its
 *   answer. The server's handlers are checked against it, and the typed client
 *   is built from it, so the UI and the server cannot drift apart. It imports
 *   only `zod` and types, so a browser bundle can use it.
 */

import type {
  DecisionRecord,
  LinkRecord,
  Paused,
  ProjectRecord,
  RunRecord,
  LimitsReport,
  StoredRunStatus,
  TriggersReport,
  UsageReport,
} from "@krapht/ork-core";
import { z } from "zod";

import {
  AFTER_API,
  type AfterResponses,
  DriverIdSchema,
} from "./contract-after.ts";
import {
  BUILDER_API,
  type BuilderResponses,
  type InputDef,
} from "./contract-builder.ts";
import { CONTEXT_API, type ContextResponses } from "./contract-context.ts";
import type { StoredEvent, TreeNode } from "./contract-ends.ts";
import type { WorkflowGraph } from "./contract-graph.ts";
import { LINKS_API } from "./contract-links.ts";
import {
  UPDATE_API,
  type UpdateResponses,
  type VersionInfo,
} from "./contract-update.ts";
import {
  WORKTREES_API,
  type WorktreesResponses,
} from "./contract-worktrees.ts";

/** `/api/usage`: the report, and the limits that apply. */
export type UsageAnswer = UsageReport & { limits: LimitsReport };

/** The records the answers are made of, for a client that imports only this. */
export type {
  DecisionRecord,
  LinkRecord,
  ProjectRecord,
  TriggersReport,
  LimitsReport,
  UsageReport,
};

const Count = z.coerce.number().int().positive();
const Seq = z.coerce.number().int().nonnegative();
export const RunsQuerySchema = z.strictObject({
  project: z.string().min(1).optional(),
  limit: Count.optional(),
});

export const UsageQuerySchema = z.strictObject({
  project: z.string().min(1).optional(),
  workflow: z.string().min(1).optional(),
  /** ISO times: `since` included, `until` not. */
  since: z.iso.datetime().optional(),
  until: z.iso.datetime().optional(),
});

export const EventsQuerySchema = z.strictObject({
  after: Seq.optional(),
  node: z.string().min(1).optional(),
  /** Only the first this many. */
  limit: Count.optional(),
  /** Only the newest this many, still oldest first. */
  last: Count.optional(),
});

export const DecisionsQuerySchema = z.strictObject({
  run: z.string().min(1).optional(),
  project: z.string().min(1).optional(),
  /** Only runs of this workflow, by name; ANDed with `run` or `project`. */
  workflow: z.string().min(1).optional(),
});

/** An answer: the option, and what the person said with it, if anything. */
export const AnswerSchema = z.strictObject({
  choose: z.string().min(1),
  note: z.string().optional(),
});

const RunFlags = {
  inputs: z.record(z.string(), z.string()).optional(),
  driver: DriverIdSchema.optional(),
  inPlace: z.boolean().optional(),
  allowDirty: z.boolean().optional(),
};

export const StartRunSchema = z.strictObject({
  /** A registered project's id or root. */
  project: z.string().min(1),
  /** A workflow's name in the project, or a path inside the project. */
  workflow: z.string().min(1),
  ...RunFlags,
  /** Its sessions load the machine's Claude setup (`--machine-claude`). */
  machineClaude: z.boolean().optional(),
});

export const ResumeRunSchema = z.strictObject(RunFlags);

export const MessageSchema = z.strictObject({
  node: z.string().min(1),
  body: z.string().min(1),
});

/** Pause, continue or stop: the whole run, or `node` alone (ADR-041). */
export const ControlSchema = z.strictObject({
  node: z.string().min(1).optional(),
});

/**
 * A stored run with its live status: `crashed` when its process is gone,
 * `paused` when it is paused as a whole; and what is paused in it.
 */
export type RunView = RunRecord & {
  live: StoredRunStatus | "crashed" | "paused";
  paused: Paused;
};

/** A workflow in a project's workflows folder, for starting a run. */
export type WorkflowView = {
  /** What `POST /api/runs` takes: the file's name without `.ork.yaml`. */
  name: string;
  file: string;
  /** The workflow's own `name` and `description`, when it parses. */
  title?: string;
  description?: string;
  inputs: Record<string, InputDef>;
  /** Why it does not parse; it can still be started, and fail there. */
  error?: string;
};

export type Health = { version: string; pid: number; startedAt: string };

/** What a start, resume, stop, pause, continue or message did. */
export type Accepted = { runId: string };

export type Route = {
  method: "GET" | "POST";
  path: `/api${string}`;
  query?: z.ZodType;
  body?: z.ZodType;
};

/** Every JSON route; the two event streams are in {@link STREAMS}. */
export const API = {
  health: { method: "GET", path: "/api/health" },
  ...BUILDER_API,
  ...CONTEXT_API,
  ...AFTER_API,
  ...WORKTREES_API,
  ...UPDATE_API,
  projects: { method: "GET", path: "/api/projects" },
  workflows: { method: "GET", path: "/api/projects/:id/workflows" },
  runs: { method: "GET", path: "/api/runs", query: RunsQuerySchema },
  run: { method: "GET", path: "/api/runs/:id" },
  tree: { method: "GET", path: "/api/runs/:id/tree" },
  graph: { method: "GET", path: "/api/runs/:id/graph" },
  events: {
    method: "GET",
    path: "/api/runs/:id/events",
    query: EventsQuerySchema,
  },
  decisions: {
    method: "GET",
    path: "/api/decisions",
    query: DecisionsQuerySchema,
  },
  decision: { method: "GET", path: "/api/decisions/:id" },
  answer: { method: "POST", path: "/api/decisions/:id", body: AnswerSchema },
  start: { method: "POST", path: "/api/runs", body: StartRunSchema },
  resume: {
    method: "POST",
    path: "/api/runs/:id/resume",
    body: ResumeRunSchema,
  },
  stop: { method: "POST", path: "/api/runs/:id/stop", body: ControlSchema },
  pause: { method: "POST", path: "/api/runs/:id/pause", body: ControlSchema },
  continue: {
    method: "POST",
    path: "/api/runs/:id/continue",
    body: ControlSchema,
  },
  message: {
    method: "POST",
    path: "/api/runs/:id/messages",
    body: MessageSchema,
  },
  usage: { method: "GET", path: "/api/usage", query: UsageQuerySchema },
  triggers: { method: "GET", path: "/api/triggers" },
  ...LINKS_API,
} as const satisfies Record<string, Route>;

/** What each route answers with, on success. */
export type Responses = BuilderResponses &
  ContextResponses &
  AfterResponses &
  WorktreesResponses &
  UpdateResponses & {
    health: Health;
    triggers: TriggersReport;
    projects: ProjectRecord[];
    workflows: WorkflowView[];
    runs: RunView[];
    run: RunView;
    tree: TreeNode[];
    graph: WorkflowGraph;
    events: StoredEvent[];
    decisions: DecisionRecord[];
    decision: DecisionRecord;
    answer: { decision: string; answer: string };
    start: Accepted;
    resume: Accepted;
    stop: Accepted;
    pause: Accepted;
    continue: Accepted;
    message: Accepted;
    usage: UsageAnswer;
    links: LinkRecord[];
    link: LinkRecord;
    unlink: { ended: true };
  };

export type RouteName = keyof typeof API;

/** The Server-Sent Event streams, and the events each sends. */
export const STREAMS = {
  /**
   * `run-event` per stored event (`id:` is its seq), then `end`. Starts after
   * `Last-Event-ID`, or `?after=`.
   */
  run: "/api/runs/:id/stream",
  /**
   * `runs`, `decisions`, `version`, each when it changes; `?project=` keeps
   * one, `?workflow=` narrows `decisions` to that workflow's. `upgrade`: the
   * upgrade's output, then `end` (contract-update.ts).
   */
  overview: "/api/stream",
  upgrade: "/api/upgrade/stream",
} as const;

export type RunStreamEvents = {
  "run-event": StoredEvent;
  /**
   * Why the stream ended: the run finished; its process is gone (`crashed`); or
   * it is no longer running otherwise. Close the `EventSource` on it, or the
   * browser reconnects.
   */
  end: { reason: "finished" | "crashed" | "ended" };
};

export type OverviewEvents = {
  runs: RunView[];
  decisions: DecisionRecord[];
  version: VersionInfo;
};

/** The `{ "error": … }` body of every refusal. */
export type ApiError = { error: string };

/** The names in a path's `:params`. */
type ParamNames<P extends string> =
  P extends `${string}:${infer Name}/${infer Rest}`
    ? Name | ParamNames<`/${Rest}`>
    : P extends `${string}:${infer Name}`
      ? Name
      : never;

export type Params<K extends RouteName> = {
  [N in ParamNames<(typeof API)[K]["path"]>]: string;
};

type SchemaOf<K extends RouteName, F extends "query" | "body"> =
  (typeof API)[K] extends Record<F, infer S extends z.ZodType>
    ? z.output<S>
    : undefined;

export type QueryOf<K extends RouteName> = SchemaOf<K, "query">;
export type BodyOf<K extends RouteName> = SchemaOf<K, "body">;

/** A route's path with its `:params` filled in, each encoded. */
export const fillPath = (path: string, params: Record<string, string>) =>
  path.replaceAll(/:(\w+)/gu, (_, name: string) =>
    encodeURIComponent(params[name] ?? ""),
  );
