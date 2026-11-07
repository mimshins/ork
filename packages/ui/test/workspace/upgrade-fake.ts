/**
 * @file A fake `ork ui` for the new-version tests: it answers the version,
 *   plan, upgrade, restart and health routes as a test says, and lists what was
 *   asked; with the app's real state on it, the streams a test drives, and a
 *   workspace whose announcements are kept. Nothing is installed or restarted;
 *   the reload is a fake too.
 */

import {
  createClient,
  type Health,
  type UpgradeJob,
  type UpgradePlanView,
  type VersionInfo,
} from "@krapht/ork-server/client";
import { vi } from "vitest";

import { createAppState } from "../../src/state/app-state.ts";
import { createWorkspace } from "../../src/workspace/workspace.ts";
import { openFakeSources } from "../fake-source.ts";

export const NOTES =
  "https://github.com/mimshins/ork/releases/tag/%40krapht%2Fork%400.4.0";

export const COMMAND = ["pnpm", "add", "--global", "@krapht/ork@0.4.0"];

export const VERSION: VersionInfo = {
  current: "0.3.0",
  latest: "0.4.0",
  newer: "0.4.0",
  checkedAt: "2026-11-07T00:00:00.000Z",
  releaseNotes: NOTES,
  check: { on: true },
  registry: null,
  job: null,
};

export const PLAN: Extract<UpgradePlanView, { kind: "command" }> = {
  kind: "command",
  planId: "plan-1",
  current: "0.3.0",
  latest: "0.4.0",
  releaseNotes: NOTES,
  installer: { id: "pnpm", label: "pnpm (global)" },
  command: COMMAND,
  running: ["4f2a1c00aaaa", "7b1d0e00bbbb"],
};

export const JOB: UpgradeJob = {
  id: "job-1",
  state: "running",
  latest: "0.4.0",
  command: COMMAND,
  startedAt: "2026-11-07T00:00:00.000Z",
};

const HEALTH: Health = { version: "0.3.0", pid: 1, startedAt: "then" };

/** An answer: a body with its status. */
type Answer = { status: number; body: unknown };

export type FakeUpgradeServer = {
  version: VersionInfo;
  /** What each ask for the plan answers, in turn; the last one stays. */
  plans: (UpgradePlanView | Answer)[];
  upgrade: Answer;
  restart: Answer;
  /**
   * What each `/api/health` answers, in turn: 0 is no answer, a number a
   * status.
   */
  health: (Health | number)[];
  /** Each route asked, as `METHOD /path`. */
  asked: string[];
};

export type FakeOptions = Partial<FakeUpgradeServer> & {
  pageVersion?: string;
  wide?: boolean;
};

const json = ({ status, body }: Answer): Response =>
  new Response(JSON.stringify(body), { status });

/** The next answer in a queue; the last one stays. */
const next = <T>(queue: T[]): T | undefined =>
  queue.length > 1 ? queue.shift() : queue[0];

const isAnswer = (value: unknown): value is Answer =>
  typeof value === "object" && value !== null && "status" in value;

const healthAnswer = (server: FakeUpgradeServer): Promise<Response> => {
  const health = next(server.health) ?? HEALTH;
  if (health === 0) return Promise.reject(new Error("connection refused"));
  return Promise.resolve(
    typeof health === "number"
      ? json({ status: health, body: { error: "Not signed in." } })
      : json({ status: 200, body: health }),
  );
};

const answerOf = (
  server: FakeUpgradeServer,
  route: string,
): Promise<Response> => {
  if (route === "GET /api/health") return healthAnswer(server);
  if (route === "GET /api/version") {
    return Promise.resolve(json({ status: 200, body: server.version }));
  }
  if (route === "POST /api/upgrade/plan") {
    const plan = next(server.plans);
    return Promise.resolve(
      json(isAnswer(plan) ? plan : { status: 200, body: plan }),
    );
  }
  if (route === "POST /api/upgrade") {
    return Promise.resolve(json(server.upgrade));
  }
  if (route === "POST /api/restart") {
    return Promise.resolve(json(server.restart));
  }
  return Promise.resolve(json({ status: 404, body: { error: "No route." } }));
};

/** The app's state on a fake `ork ui`, following its overview stream. */
export const openFakeUpgrade = (over: FakeOptions = {}) => {
  const server: FakeUpgradeServer = {
    version: VERSION,
    plans: [PLAN],
    upgrade: { status: 202, body: { job: JOB } },
    restart: { status: 202, body: { port: 4417, pid: 1 } },
    health: [HEALTH],
    asked: [],
    ...over,
  };
  const client = createClient({
    fetch: (input, init) => {
      const url = new URL(
        input instanceof Request ? input.url : input,
        "http://ork.test",
      );
      const route = `${init?.method ?? "GET"} ${url.pathname}`;
      server.asked.push(route);
      return answerOf(server, route);
    },
  });
  const sources = openFakeSources();
  const state = createAppState({
    client,
    open: sources.open,
    storage: localStorage,
    pageVersion: over.pageVersion ?? null,
  });
  const workspace = createWorkspace({
    storage: localStorage,
    wide: over.wide ?? true,
  });
  const said = vi.spyOn(workspace, "announce");
  const reload = vi.fn<() => void>();
  state.start();
  return {
    server,
    state,
    workspace,
    said,
    reload,
    sources,
    overview: sources.last(),
  };
};
