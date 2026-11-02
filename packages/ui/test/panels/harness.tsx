/**
 * @file The panels' tests' setup: the app's real state on a fake server, drawn
 *   with the providers a panel has in the app, and the overview stream to feed
 *   it. The fake answers the routes these panels read, and records every
 *   start.
 */

import {
  createClient,
  type ProjectRecord,
  type WorkflowView,
} from "@krapht/ork-server/client";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";

import { TipProvider } from "../../src/components/tip.tsx";
import { Toasts } from "../../src/components/toast.tsx";
import { createAppState } from "../../src/state/app-state.ts";
import { AppStateProvider } from "../../src/state/context.tsx";
import { openFakeSources } from "../fake-source.ts";

export type FakeRoutes = {
  projects?: ProjectRecord[];
  workflows?: Record<string, WorkflowView[]>;
  /** The server's refusal of a start, if it refuses. */
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
  const answer = (path: string, body: unknown): Response => {
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
  return { state, overview: sources.last(), started };
};

export type PanelState = ReturnType<typeof openPanelState>["state"];

export const renderPanel = (state: PanelState, panel: ReactNode) =>
  render(
    <AppStateProvider value={state}>
      <TipProvider>
        <Toasts>{panel}</Toasts>
      </TipProvider>
    </AppStateProvider>,
  );
