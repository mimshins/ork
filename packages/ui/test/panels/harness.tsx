/**
 * @file The panels' tests' setup: the app's real state on a fake server, drawn
 *   with the providers a panel has in the app, and the overview stream to feed
 *   it. The fake answers the routes these panels read, and records every
 *   start.
 */

import {
  createClient,
  type DecisionRecord,
  type LinkRecord,
  type ProjectRecord,
  type RunView,
  type StoredEvent,
  type TreeNode,
  type TriggersReport,
  type UsageReport,
  type WorkflowGraph,
  type WorkflowView,
} from "@krapht/ork-server/client";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";

import { TipProvider } from "../../src/components/tip.tsx";
import { Toasts } from "../../src/components/toast.tsx";
import { createAppState } from "../../src/state/app-state.ts";
import { AppStateProvider } from "../../src/state/context.tsx";
import {
  type Workspace,
  WorkspaceContext,
} from "../../src/workspace/context.ts";
import { openFakeSources } from "../fake-source.ts";
import { LIST_FIELDS } from "../filter-fields.ts";

export type FakeRoutes = {
  projects?: ProjectRecord[];
  triggers?: TriggersReport;
  workflows?: Record<string, WorkflowView[]>;
  /** The server's refusal of a start, if it refuses. */
  refuse?: string;
  /** What it says of a run; a test can change it between reads. */
  monitor?: MonitorRoutes;
  /** Each decision's record, as read on its own. */
  decisions?: Record<string, DecisionRecord>;
  /** Why it refuses an answer, if it does. */
  refuseAnswer?: string;
  /** A run's stored events, as read a page at a time. */
  events?: StoredEvent[];
  /** What it reports of usage, given what was asked. */
  usage?: (query: URLSearchParams) => UsageReport | { error: string };
  /** What `GET /api/runs` says for a filter; an `error` is a 400. */
  runs?: (query: URLSearchParams) => RunView[] | { error: string };
  /** Why it refuses a usage report, if it does. */
  refuseUsage?: string;
  /** The builder's routes, when a test plays them. */
  builder?: (
    path: string,
    body: unknown,
    query: URLSearchParams,
  ) => Response | undefined;
};

export type MonitorRoutes = {
  tree: TreeNode[];
  graph: WorkflowGraph;
  links?: LinkRecord[];
  /** The server's refusal of a pause, continue or stop, if it refuses. */
  refuse?: string;
};

export const project = (id: string): ProjectRecord => ({
  id,
  root: `/repos/${id}`,
  mode: "in-repo",
  dir: `/repos/${id}/.ork`,
  registeredAt: "2026-11-02T00:00:00.000Z",
});

export const workflowNamed = (
  name: string,
  inputs: WorkflowView["inputs"] = {},
): WorkflowView => ({ name, file: `/w/${name}.ork.yaml`, title: name, inputs });

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

export const openPanelState = (routes: FakeRoutes = {}) => {
  const started: unknown[] = [];
  const controlled: { kind: string; run: string; body: unknown }[] = [];
  const answer = (path: string, body: unknown, query = ""): Response => {
    const { monitor } = routes;
    const built = routes.builder?.(path, body, new URLSearchParams(query));
    if (built !== undefined) return built;
    if (path === "/api/usage") {
      const report = routes.usage?.(new URLSearchParams(query)) ?? {
        totals: { sessions: 0 },
        limits: { problems: [], caps: [], plan: [] },
        groups: {},
        hints: [],
      };
      if (routes.refuseUsage !== undefined) {
        return json({ error: routes.refuseUsage }, 500);
      }
      return "error" in report ? json(report, 400) : json(report);
    }
    if (path === "/api/runs" && body === undefined) {
      const rows = routes.runs?.(new URLSearchParams(query)) ?? [];
      return "error" in rows ? json(rows, 400) : json(rows);
    }
    const decision = /^\/api\/decisions\/(.+)$/u.exec(path)?.[1];
    if (decision !== undefined) {
      if (body === undefined) {
        const record = routes.decisions?.[decision];
        return record === undefined
          ? json({ error: "No decision." }, 404)
          : json(record);
      }
      if (routes.refuseAnswer !== undefined) {
        return json({ error: routes.refuseAnswer }, 409);
      }
      controlled.push({ kind: "answer", run: decision, body });
      return json({ decision, answer: "" });
    }
    if (/^\/api\/runs\/[^/]+\/events$/u.test(path)) {
      return json(routes.events ?? []);
    }
    if (path === "/api/links") return json(monitor?.links ?? []);
    const [, run = "", kind = ""] =
      /^\/api\/runs\/([^/]+)\/(tree|graph|pause|continue|stop|resume|message)s?$/u.exec(
        path,
      ) ?? [];
    if (kind === "tree") return json(monitor?.tree ?? []);
    if (kind === "graph") return json(monitor?.graph ?? {});
    if (kind !== "") {
      if (monitor?.refuse !== undefined) {
        return json({ error: monitor.refuse }, 409);
      }
      controlled.push({ kind, run, body });
      return json({ runId: run }, 202);
    }
    if (path === "/api/runs") {
      if (routes.refuse !== undefined) {
        return json({ error: routes.refuse }, 409);
      }
      started.push(body);
      return json({ runId: "new11111" }, 202);
    }
    if (path === "/api/projects") return json(routes.projects ?? []);
    if (path === "/api/list-fields") return json(LIST_FIELDS);
    if (path === "/api/triggers") {
      return json(routes.triggers ?? { broken: [], triggers: [] });
    }
    const id = /^\/api\/projects\/(.+)\/workflows$/u.exec(path)?.[1];
    return json(routes.workflows?.[id ?? ""] ?? []);
  };
  const client = createClient({
    fetch: (input, init) => {
      const url = new URL(
        input instanceof Request ? input.url : input,
        "http://ork.test",
      );
      const body: unknown =
        typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      return Promise.resolve(answer(url.pathname, body, url.search));
    },
  });
  const sources = openFakeSources();
  const state = createAppState({
    client,
    open: sources.open,
    storage: localStorage,
  });
  state.start();
  return { state, overview: sources.last(), started, controlled, sources };
};

export type PanelState = ReturnType<typeof openPanelState>["state"];

export const renderPanel = (
  state: PanelState,
  panel: ReactNode,
  workspace: Workspace | null = null,
) =>
  render(
    <AppStateProvider value={state}>
      <TipProvider>
        <WorkspaceContext value={workspace}>
          <Toasts>{panel}</Toasts>
        </WorkspaceContext>
      </TipProvider>
    </AppStateProvider>,
  );
