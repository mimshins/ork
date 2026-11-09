/**
 * @file The API's read routes (specs/server/api.md): health, projects and a
 *   project's workflows, runs, a run, its tree and its events, the open
 *   decisions, and usage. Each reads the store as the matching CLI command does
 *   (`ork projects`, `ps`, `tree`, `logs`, `decide --list`, `usage`).
 */

import {
  isNodeEvent,
  pendingDecisions,
  activeTree,
  capsHere,
  limitsReport,
  nestItems,
  placeFor,
  triggersReport,
  usageReport,
} from "@krapht/ork-core";

import { projectOf, runOf, type ServerContext, viewOf } from "./context.ts";
import { runGraph } from "./graph.ts";
import { fail, type Handlers, ok } from "./router.ts";
import { projectWorkflows } from "./workflows.ts";

type ReadRoutes = Pick<
  Handlers,
  | "health"
  | "projects"
  | "workflows"
  | "runs"
  | "run"
  | "tree"
  | "graph"
  | "events"
  | "decisions"
  | "decision"
  | "links"
  | "usage"
  | "triggers"
>;

/** A project filter's root: a registered project's, or the value as a root. */
/** A registered project's place; caps are only known for one. */
const placeOf = (context: ServerContext, key: string | undefined) => {
  const known = key === undefined ? undefined : projectOf(context, key);
  return known === undefined
    ? undefined
    : placeFor(known.root, context.store.projects());
};

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

  triggers: () =>
    ok(triggersReport(context.store, context.store.projects(), context.home)),

  links: ({ query }) =>
    ok(context.store.links(query.run === undefined ? {} : { run: query.run })),

  usage: ({ query }) =>
    ok({
      ...usageReport(
        context.store.usage({
          ...(query.project === undefined
            ? {}
            : { project: projectRoot(context, query.project) }),
          ...(query.workflow === undefined ? {} : { workflow: query.workflow }),
          ...(query.since === undefined ? {} : { since: query.since }),
          ...(query.until === undefined ? {} : { until: query.until }),
        }),
      ),
      limits: limitsReport(
        context.store,
        capsHere(context.home, placeOf(context, query.project)),
        new Date(),
      ),
    }),

  workflows: ({ params }) => {
    const project = projectOf(context, params.id);
    return project === undefined
      ? fail(404, `No registered project \`${params.id}\`.`)
      : ok(projectWorkflows(project));
  },

  runs: ({ query }) =>
    ok(
      context.store
        .runs({
          limit: query.limit ?? 20,
          ...(query.project === undefined
            ? {}
            : { project: projectRoot(context, query.project) }),
        })
        .map(run => viewOf(context, run)),
    ),

  run: ({ params }) => {
    const found = runOf(context, params.id);
    return found.ok ? ok(viewOf(context, found.run)) : found.refusal;
  },

  tree: ({ params }) => {
    const found = runOf(context, params.id);
    if (!found.ok) return found.refusal;
    return ok(nestItems(activeTree(context.store.events(found.run.id))));
  },

  graph: ({ params }) => {
    const found = runOf(context, params.id);
    if (!found.ok) return found.refusal;
    return ok(
      runGraph(
        context.store.events(found.run.id).map(s => s.event),
        found.run.file,
      ),
    );
  },

  events: ({ params, query }) => {
    const found = runOf(context, params.id);
    if (!found.ok) return found.refusal;
    const events = context.store
      .events(found.run.id, query.after ?? 0)
      .filter(
        s => query.node === undefined || isNodeEvent(s.event, query.node),
      );
    const newest =
      query.last === undefined ? events : events.slice(-query.last);
    return ok(
      query.limit === undefined ? newest : newest.slice(0, query.limit),
    );
  },

  decisions: ({ query }) => {
    const workflow =
      query.workflow === undefined ? {} : { workflow: query.workflow };
    if (query.run === undefined) {
      return ok(
        pendingDecisions(context.store, {
          ...workflow,
          ...(query.project === undefined
            ? {}
            : { project: projectRoot(context, query.project) }),
        }),
      );
    }
    const found = runOf(context, query.run);
    if (!found.ok) return found.refusal;
    return ok(
      pendingDecisions(context.store, { ...workflow, runId: found.run.id }),
    );
  },

  decision: ({ params }) => {
    const found = context.store.decision(params.id);
    return found === undefined
      ? fail(404, `No decision \`${params.id}\`.`)
      : ok(found);
  },
});
