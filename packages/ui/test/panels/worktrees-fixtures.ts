/**
 * @file The Worktrees panel's tests' fixtures: rows as the server words them
 *   (core's words), two projects and a third with nothing left, and a fake
 *   server for the worktrees routes that records what each call sent and
 *   answers with the plans a test sets.
 */

import type {
  CleanPlanProject,
  RemovePlanAnswer,
  WorktreeRow,
  WorktreesProject,
} from "@krapht/ork-server/client";

export const row = (
  label: string,
  over: Partial<WorktreeRow> = {},
): WorktreeRow => {
  const [, runId = "", nodeId = ""] = label.split("/");
  return {
    branch: label,
    runId,
    nodeId,
    path: `/code/app-worktrees/ork-${runId}-${nodeId}`,
    missing: false,
    dirty: false,
    changes: 0,
    ahead: 0,
    merged: true,
    inMainCheckout: false,
    key: label,
    label,
    state: "merged",
    parts: [],
    run: { known: true, live: false },
    remove: { label: "Remove…" },
    ...over,
  };
};

export const BUILD = row("ork/4f2a1c/build");

export const LEAD = row("ork/9b1e07/lead", {
  dirty: true,
  changes: 2,
  ahead: 3,
  merged: false,
  state: "unmerged",
  parts: [
    { text: "uncommitted changes", risk: true },
    { text: "3 commits not merged", risk: false },
  ],
});

export const DOCS = row("ork/77c0de/docs", {
  path: null,
  parts: [{ text: "no worktree", risk: false }],
  run: { known: false, live: false },
  remove: { label: "Delete branch…" },
});

export const project = (
  name: string,
  items: WorktreeRow[],
  over: Partial<WorktreesProject> = {},
): WorktreesProject => ({
  root: `/code/${name}`,
  name,
  head: "main",
  items,
  ...over,
});

export const PROJECTS: WorktreesProject[] = [
  project("app", [BUILD, LEAD, DOCS]),
  project("api", [], { error: "Not in a git repository with a commit." }),
  project("web", []),
];

export const plan = (
  text: string,
  over: Partial<RemovePlanAnswer> = {},
): RemovePlanAnswer => ({
  parts: [],
  merged: true,
  ahead: 0,
  line: { text },
  removeWorktree: true,
  deleteBranch: false,
  prunes: false,
  force: false,
  losing: {
    changes: [],
    commits: [],
    commitsOn: null,
    more: { changes: 0, commits: 0 },
  },
  digest: `digest of ${text}`,
  ...over,
});

export const FORCED = plan("ork/9b1e07/lead: remove worktree", {
  parts: [
    { text: "uncommitted changes", risk: true },
    { text: "3 commits not merged into main", risk: false },
  ],
  merged: false,
  ahead: 3,
  force: true,
  losing: {
    changes: [" M src/login.ts", "?? notes.md"],
    commits: [],
    commitsOn: null,
    more: { changes: 0, commits: 0 },
  },
});

/** The plan with and without the branch, as the box changes it. */
export const branchPlans = (deleteBranch: boolean): RemovePlanAnswer =>
  deleteBranch
    ? plan("ork/4f2a1c/build: remove worktree + delete branch", {
        deleteBranch: true,
      })
    : plan("ork/4f2a1c/build: remove worktree");

/** A plan that, read again, has changed: now it loses work. */
export const changingPlans = (): ((
  deleteBranch: boolean,
) => RemovePlanAnswer) => {
  let reads = 0;
  return () => {
    reads += 1;
    return reads === 1 ? plan("ork/4f2a1c/build: remove worktree") : FORCED;
  };
};

export const CLEAN: CleanPlanProject[] = [
  {
    root: "/code/app",
    name: "app",
    head: "main",
    steps: [
      {
        key: BUILD.key,
        line: { text: "ork/4f2a1c/build: remove worktree" },
        removeWorktree: true,
        deleteBranch: false,
        prunes: false,
      },
      {
        key: DOCS.key,
        line: { text: "ork/77c0de/docs: keep" },
        removeWorktree: false,
        deleteBranch: false,
        prunes: false,
      },
    ],
  },
];

export type Asked = { route: string; body: unknown };

export type WorktreesServer = {
  projects: WorktreesProject[];
  /** The remove plan, by whether the branch goes too. */
  plans: (deleteBranch: boolean) => RemovePlanAnswer;
  clean: CleanPlanProject[];
  /** A route's refusal, the first time it's called. */
  refuse?: Record<string, { status: number; error: string }>;
  asked: Asked[];
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

const deleteBranchIn = (body: unknown): boolean =>
  typeof body === "object" &&
  body !== null &&
  "deleteBranch" in body &&
  body.deleteBranch === true;

const keyIn = (body: unknown): string =>
  typeof body === "object" &&
  body !== null &&
  "key" in body &&
  typeof body.key === "string"
    ? body.key
    : "";

const withoutItem = (
  from: WorktreesProject,
  key: string,
): WorktreesProject => ({
  ...from,
  items: from.items.filter(item => item.key !== key),
});

const ROUTES: Record<string, string> = {
  "/api/worktrees": "list",
  "/api/worktrees/remove/plan": "removePlan",
  "/api/worktrees/remove": "remove",
  "/api/worktrees/clean/plan": "cleanPlan",
  "/api/worktrees/clean": "clean",
};

const answerTo = (
  server: WorktreesServer,
  route: string,
  body: unknown,
): Response => {
  if (route === "list") return json({ projects: server.projects });
  if (route === "removePlan") return json(server.plans(deleteBranchIn(body)));
  if (route === "remove") {
    // Gone from the next list, as git would have it.
    const key = keyIn(body);
    server.projects = server.projects.map(p => withoutItem(p, key));
    return json({ done: ["removed"] });
  }
  if (route === "cleanPlan") {
    return json({ projects: server.clean, digest: "clean digest" });
  }
  return json({
    projects: [
      {
        root: "/code/app",
        name: "app",
        done: ["removed /code/app-worktrees/ork-4f2a1c-build"],
      },
    ],
  });
};

export const worktreesRoute =
  (server: WorktreesServer) =>
  (path: string, body: unknown): Response | undefined => {
    const route = ROUTES[path];
    if (route === undefined) return undefined;
    server.asked.push({ route, body });
    const refusal = server.refuse?.[route];
    if (refusal !== undefined) {
      delete server.refuse?.[route];
      return json({ error: refusal.error }, refusal.status);
    }
    return answerTo(server, route, body);
  };
