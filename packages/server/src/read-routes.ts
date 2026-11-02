/**
 * @file The API's read routes (specs/server.md#api): health, projects, runs, a
 *   run, its tree and its events, and the open decisions. Each reads the store
 *   as the matching CLI command does (`ork projects`, `ps`, `tree`, `logs`,
 *   `decide --list`).
 */

import { nodeOf, pendingDecisions, runTree } from "@krapht/ork-core";

import { projectOf, runOf, type ServerContext, viewOf } from "./context.ts";
import { type Handlers, ok } from "./router.ts";

type ReadRoutes = Pick<
  Handlers,
  "health" | "projects" | "runs" | "run" | "tree" | "events" | "decisions"
>;

/** A project filter's root: a registered project's, or the value as a root. */
const projectRoot = (context: ServerContext, key: string): string =>
  projectOf(context, key)?.root ?? key;

export const readRoutes = (context: ServerContext): ReadRoutes => ({
  health: () =>
    ok({
      version: context.version,
      pid: context.pid,
      startedAt: context.startedAt,
    }),

  projects: () => ok(context.store.projects()),

  runs: ({ query }) =>
    ok(
      context.store
        .runs({
          limit: query.limit ?? 20,
          ...(query.project === undefined
            ? {}
            : { project: projectRoot(context, query.project) }),
        })
        .map(run => viewOf(run)),
    ),

  run: ({ params }) => {
    const found = runOf(context, params.id);
    return found.ok ? ok(viewOf(found.run)) : found.refusal;
  },

  tree: ({ params }) => {
    const found = runOf(context, params.id);
    if (!found.ok) return found.refusal;
    return ok(runTree(context.store.events(found.run.id).map(s => s.event)));
  },

  events: ({ params, query }) => {
    const found = runOf(context, params.id);
    if (!found.ok) return found.refusal;
    const events = context.store
      .events(found.run.id, query.after ?? 0)
      .filter(s => query.node === undefined || nodeOf(s.event) === query.node);
    return ok(
      query.limit === undefined ? events : events.slice(0, query.limit),
    );
  },

  decisions: ({ query }) => {
    if (query.run === undefined) {
      return ok(
        pendingDecisions(
          context.store,
          query.project === undefined
            ? {}
            : { project: projectRoot(context, query.project) },
        ),
      );
    }
    const found = runOf(context, query.run);
    if (!found.ok) return found.refusal;
    return ok(pendingDecisions(context.store, { runId: found.run.id }));
  },
});
