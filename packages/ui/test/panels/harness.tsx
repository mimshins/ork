/**
 * @file The panels' tests' setup: the app's real state on a fake server, drawn
 *   with the providers a panel has in the app, and the overview stream to feed
 *   it. The fake answers the routes these panels read, and records every
 *   start.
 */

import {
  createClient,
  type LinkRecord,
  type ProjectRecord,
  type TreeNode,
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

export type FakeRoutes = {
  projects?: ProjectRecord[];
  workflows?: Record<string, WorkflowView[]>;
  /** The server's refusal of a start, if it refuses. */
  refuse?: string;
  /** What it says of a run; a test can change it between reads. */
  monitor?: MonitorRoutes;
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
  const answer = (path: string, body: unknown): Response => {
    const { monitor } = routes;
    if (path === "/api/links") return json(monitor?.links ?? []);
    const [, run = "", kind = ""] =
      /^\/api\/runs\/([^/]+)\/(tree|graph|pause|continue|stop)$/u.exec(path) ??
      [];
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
    const id = /^\/api\/projects\/(.+)\/workflows$/u.exec(path)?.[1];
    return json(routes.workflows?.[id ?? ""] ?? []);
  };
  const client = createClient({
    fetch: (input, init) => {
      const path = new URL(
        input instanceof Request ? input.url : input,
        "http://ork.test",
      ).pathname;
      const body: unknown =
        typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      return Promise.resolve(answer(path, body));
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
