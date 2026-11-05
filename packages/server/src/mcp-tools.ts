/**
 * @file The tools `ork mcp` serves Claude Code (RFC-012): what a project has,
 *   the workflow format, runs, their events, what they spent, and what waits on
 *   a person. Each answers from the same handler as `ork ui`'s API, and they
 *   are built from its read routes and the builder's catalog alone, so none can
 *   answer a decision, start, stop, pause or message a run.
 */

import { z } from "zod";

import { builderRoutes } from "./builder-routes.ts";
import type { ServerContext } from "./context.ts";
import {
  DecisionsQuerySchema,
  EventsQuerySchema,
  RunsQuerySchema,
  UsageQuerySchema,
} from "./contract.ts";
import { formatPart, fromReply, refused } from "./mcp-answers.ts";
import { tool, type McpTool } from "./mcp-tool.ts";
import { readRoutes } from "./read-routes.ts";

const NO_QUERY = { params: {}, query: undefined, body: undefined };

/** How many events `run_events` gives when it's asked for no range. */
const RECENT_EVENTS = 30;

/** Said with the open decisions: this server can't answer them. */
const ANSWERED_BY_A_PERSON =
  "Only a person answers these: in `ork ui`, or with `ork decide` in their own terminal. Tell them what waits, and where.";

const project = z.string().min(1).describe("A registered project's id or root");
const run = z.string().min(1).describe("A run's id, or a unique start of it");

export const mcpTools = (context: ServerContext): McpTool[] => {
  const read = readRoutes(context);
  const { builderCatalog } = builderRoutes(context);
  return [
    tool(
      "projects",
      "The projects registered with Ork on this machine.",
      {},
      () => fromReply(read.projects(NO_QUERY)),
    ),
    tool(
      "workflows",
      "A project's workflows: each one's name to start it by, its description and inputs, or why it doesn't parse.",
      { project },
      args =>
        fromReply(
          read.workflows({ ...NO_QUERY, params: { id: args.project } }),
        ),
    ),
    tool(
      "workflow_format",
      "The workflow file format's JSON Schema. With no node type: the workflow's own fields and the node types there are. With one: that node type's fields.",
      { nodeType: z.string().min(1).optional() },
      args => formatPart(args.nodeType),
    ),
    tool(
      "agents",
      "The agents and skills a project's nodes can use, and where each comes from.",
      { project },
      args =>
        fromReply(
          builderCatalog({ ...NO_QUERY, params: { id: args.project } }),
        ),
    ),
    tool(
      "runs",
      "Runs, newest first, with their live status and cost. 10 unless a limit is given.",
      RunsQuerySchema.shape,
      args =>
        fromReply(read.runs({ ...NO_QUERY, query: { limit: 10, ...args } })),
    ),
    tool(
      "run",
      "One run: its status, what it waits on, its cost, and each node's state.",
      { run },
      async args => {
        const view = await read.run({ ...NO_QUERY, params: { id: args.run } });
        if ("error" in view) return refused(view.error);
        const tree = read.tree({ ...NO_QUERY, params: { id: view.body.id } });
        return fromReply(tree, nodes => ({ run: view.body, nodes }));
      },
    ),
    tool(
      "run_events",
      `A run's events, oldest first, long values cut. With no range, the newest ${String(RECENT_EVENTS)}.`,
      { run, ...EventsQuerySchema.shape },
      ({ run: id, ...query }) => {
        const range =
          query.after === undefined &&
          query.limit === undefined &&
          query.last === undefined
            ? { last: RECENT_EVENTS }
            : {};
        return fromReply(
          read.events({
            ...NO_QUERY,
            params: { id },
            query: { ...range, ...query },
          }),
        );
      },
    ),
    tool(
      "usage",
      "What runs spent, by workflow and model, and how close the limits are. `since` and `until` are ISO times.",
      UsageQuerySchema.shape,
      args => fromReply(read.usage({ ...NO_QUERY, query: args })),
    ),
    tool(
      "decisions",
      "The decisions open in live runs, waiting on a person. This server can't answer them.",
      DecisionsQuerySchema.shape,
      args =>
        fromReply(read.decisions({ ...NO_QUERY, query: args }), open => ({
          open,
          answer: ANSWERED_BY_A_PERSON,
        })),
    ),
  ];
};
