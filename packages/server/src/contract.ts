/**
 * @file The HTTP API's contract (ADR-039, specs/server.md#api): each route's
 *   method and path, the Zod schemas of its query and body, and the type of its
 *   answer. The server's handlers are checked against it, and the typed client
 *   is built from it, so the UI and the server cannot drift apart. It imports
 *   only `zod` and types, so a browser bundle can use it.
 */

import type {
  DecisionRecord,
  ProjectRecord,
  RunRecord,
  StoredEvent,
  StoredRunStatus,
  TreeNode,
} from "@krapht/ork-core";
import { z } from "zod";

const Count = z.coerce.number().int().positive();
const Seq = z.coerce.number().int().nonnegative();
const Driver = z.enum(["sdk", "cli"]);

export const RunsQuerySchema = z.strictObject({
  project: z.string().min(1).optional(),
  limit: Count.optional(),
});

export const EventsQuerySchema = z.strictObject({
  after: Seq.optional(),
  node: z.string().min(1).optional(),
  limit: Count.optional(),
});

export const DecisionsQuerySchema = z.strictObject({
  run: z.string().min(1).optional(),
  project: z.string().min(1).optional(),
});

export const AnswerSchema = z.strictObject({ choose: z.string().min(1) });

const RunFlags = {
  inputs: z.record(z.string(), z.string()).optional(),
  driver: Driver.optional(),
  inPlace: z.boolean().optional(),
  allowDirty: z.boolean().optional(),
};

export const StartRunSchema = z.strictObject({
  /** A registered project's id or root. */
  project: z.string().min(1),
  /** A workflow's name in the project, or a path inside the project. */
  workflow: z.string().min(1),
  ...RunFlags,
});

export const ResumeRunSchema = z.strictObject(RunFlags);

export const MessageSchema = z.strictObject({
  node: z.string().min(1),
  body: z.string().min(1),
});

/** A stored run with its live status (`crashed` when its process is gone). */
export type RunView = RunRecord & { live: StoredRunStatus | "crashed" };

export type Health = { version: string; pid: number; startedAt: string };

/** What a start, resume, stop or message did. */
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
  projects: { method: "GET", path: "/api/projects" },
  runs: { method: "GET", path: "/api/runs", query: RunsQuerySchema },
  run: { method: "GET", path: "/api/runs/:id" },
  tree: { method: "GET", path: "/api/runs/:id/tree" },
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
  answer: { method: "POST", path: "/api/decisions/:id", body: AnswerSchema },
  start: { method: "POST", path: "/api/runs", body: StartRunSchema },
  resume: {
    method: "POST",
    path: "/api/runs/:id/resume",
    body: ResumeRunSchema,
  },
  stop: { method: "POST", path: "/api/runs/:id/stop" },
  message: {
    method: "POST",
    path: "/api/runs/:id/messages",
    body: MessageSchema,
  },
} as const satisfies Record<string, Route>;

/** What each route answers with, on success. */
export type Responses = {
  health: Health;
  projects: ProjectRecord[];
  runs: RunView[];
  run: RunView;
  tree: TreeNode[];
  events: StoredEvent[];
  decisions: DecisionRecord[];
  answer: { decision: string; answer: string };
  start: Accepted;
  resume: Accepted;
  stop: Accepted;
  message: Accepted;
};

export type RouteName = keyof typeof API;

/** The Server-Sent Event streams, and the events each sends. */
export const STREAMS = {
  /**
   * `run-event` per stored event (`id:` is its seq), then `end`. Starts after
   * `Last-Event-ID`, or `?after=`.
   */
  run: "/api/runs/:id/stream",
  /** `runs` and `decisions`, each when it changes; `?project=` keeps one. */
  overview: "/api/stream",
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
