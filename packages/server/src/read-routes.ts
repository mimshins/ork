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
  ALL,
  applyFilters,
  capsHere,
  decisionListTable,
  limitsReport,
  type ListTable,
  nestItems,
  placeFor,
  runListTable,
  triggersReport,
  usageListTable,
  usageReport,
} from "@krapht/ork-core";

import {
  projectOf,
  runOf,
  type ServerContext,
  viewOf,
  viewWithOutputs,
} from "./context.ts";
import type { RunView } from "./contract.ts";
import { servedEvent, treeWithEnds } from "./end-view.ts";
import { runGraph } from "./graph.ts";
import { listFieldsRoutes } from "./list-fields-routes.ts";
import { filterOf, projectRootOf } from "./list-query.ts";
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
  | "listFields"
  | "triggers"
>;

/** A registered project's place; caps are only known for one. */
const placeOf = (context: ServerContext, key: string | undefined) => {
  const known = key === undefined ? undefined : projectOf(context, key);
  return known === undefined
    ? undefined
    : placeFor(known.root, context.store.projects());
};

/** `ork ps`'s table, matching `--status` on the live status the API shows. */
const liveRunTable: ListTable<RunView> = {
  ...runListTable,
  fields: runListTable.fields.map(field =>
    field.name === "status"
      ? Object.assign({}, field, { get: (run: RunView) => run.live })
      : field,
  ),
};

export const readRoutes = (context: ServerContext): ReadRoutes => ({
  ...listFieldsRoutes(),
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

  usage: ({ query }) => {
    const read = filterOf(usageListTable, query);
    if (!read.ok) return read.refusal;
    const { filter } = read;
    const { workflow, since, until } = filter;
    const root = projectRootOf(context, filter);
    return ok({
      ...usageReport(
        context.store.usage({
          ...(root === undefined ? {} : { project: root }),
          ...(workflow === undefined ? {} : { workflow }),
          ...(since === undefined || since === ALL ? {} : { since }),
          ...(until === undefined ? {} : { until }),
        }),
      ),
      limits: limitsReport(
        context.store,
        capsHere(context.home, placeOf(context, root)),
        new Date(),
      ),
    });
  },

  workflows: ({ params }) => {
    const project = projectOf(context, params.id);
    return project === undefined
      ? fail(404, `No registered project \`${params.id}\`.`)
      : ok(projectWorkflows(project));
  },

  runs: ({ query }) => {
    const read = filterOf(liveRunTable, query);
    if (!read.ok) return read.refusal;
    const root = projectRootOf(context, read.filter);
    const limit = query.limit ?? 20;
    // Only a filter on the runs themselves needs more than the newest `limit`.
    const narrowed = Object.keys(read.filter).some(name => name !== "project");
    const views = context.store
      .runs({
        ...(root === undefined ? {} : { project: root }),
        ...(narrowed ? {} : { limit }),
      })
      .map(run => viewOf(context, run));
    return ok(applyFilters(liveRunTable, views, read.filter).slice(0, limit));
  },

  run: ({ params }) => {
    const found = runOf(context, params.id);
    return found.ok ? ok(viewWithOutputs(context, found.run)) : found.refusal;
  },

  tree: ({ params }) => {
    const found = runOf(context, params.id);
    if (!found.ok) return found.refusal;
    const stored = context.store.events(found.run.id);
    return ok(treeWithEnds(nestItems(activeTree(stored)), stored));
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
      (query.limit === undefined ? newest : newest.slice(0, query.limit)).map(
        stored => servedEvent(stored),
      ),
    );
  },

  decisions: ({ query }) => {
    const read = filterOf(decisionListTable, query);
    if (!read.ok) return read.refusal;
    const { run, workflow: named } = read.filter;
    const workflow = named === undefined ? {} : { workflow: named };
    if (run === undefined) {
      const root = projectRootOf(context, read.filter);
      return ok(
        pendingDecisions(context.store, {
          ...workflow,
          ...(root === undefined ? {} : { project: root }),
        }),
      );
    }
    const found = runOf(context, run);
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
