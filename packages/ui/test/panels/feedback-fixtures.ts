/**
 * @file The Feedback panel's tests' data and fake server: items as `GET
 *   /api/feedback` sends them, an item's detail with its records and what it
 *   allows, and answers to every feedback route that record what was asked, so
 *   a test can see what was sent (and that nothing was posted unasked).
 */

import type {
  FeedbackActions,
  FeedbackDetail,
  FeedbackItem,
  FeedbackRecord,
  PublishPreview,
} from "@krapht/ork-server/client";

export const ORK = "0893f0aa11bb";
export const LOOP = "9fae0c1d2e3f";
export const AGENTS = "17817ce9802a";
export const MERGED = "bd3839d0d16e";

/** A whole fingerprint from the first 12 characters the CLI shows. */
export const whole = (short: string): string => short.padEnd(40, "0");

export const item = (
  short: string,
  over: Partial<FeedbackItem> = {},
): FeedbackItem => ({
  id: whole(short),
  merged: [],
  status: "new",
  title: `Title of ${short}`,
  target: "workflow",
  kind: "friction",
  severity: "medium",
  sources: ["system"],
  count: 1,
  firstSeen: "2026-11-04T09:12:00.000Z",
  lastSeen: "2026-11-04T12:04:31.000Z",
  runs: ["4f2a1c00"],
  workflows: ["review-loop"],
  models: [],
  ...over,
});

/** Three items: one about a workflow, one about the project, one about Ork. */
export const ITEMS: FeedbackItem[] = [
  item(LOOP, {
    title: "The loop reviews -> lead ran out of its 2 rounds",
    count: 3,
    runs: ["4f2a1c00", "77aa0000"],
    severity: "high",
  }),
  item(AGENTS, {
    title: "AGENTS.md has no test command",
    target: "project",
    kind: "context-gap",
  }),
  item(ORK, {
    title: "`feedback` tool error: invalid evidence",
    target: "ork",
    kind: "bug",
    workflows: [],
  }),
];

export const record = (
  short: string,
  over: Partial<FeedbackRecord["feedback"]> = {},
  at: Partial<FeedbackRecord> = {},
): FeedbackRecord => ({
  id: 1,
  runId: "4f2a1c00",
  seq: 3,
  at: "2026-11-04T12:04:31.000Z",
  node: "reviews",
  feedback: {
    source: "system",
    kind: "friction",
    target: "workflow",
    severity: "high",
    title: "",
    body: "The loop ran out.",
    evidence: [],
    code: "loop.exhausted",
    fingerprint: whole(short),
    origin: {},
    ...over,
  },
  ...at,
});

const OK = { ok: true } as const;

export const ALLOWED: FeedbackActions = {
  accept: OK,
  lesson: OK,
  apply: OK,
  publish: OK,
};

export const refused = (why: string) => ({
  ok: false as const,
  why,
  error: `${why}.`,
});

export const detailOf = (
  of: FeedbackItem,
  over: Partial<FeedbackDetail> = {},
): FeedbackDetail => ({
  item: of,
  records: [record(of.id.slice(0, 12), { title: of.title })],
  actions: ALLOWED,
  lessons: of.workflows.map(workflow => ({
    ok: true,
    workflow,
    file: `.ork/lessons/${workflow}.md`,
    root: "/code/app",
    tokens: 412,
    exists: true,
  })),
  lessonCap: 1500,
  project: { ok: true, root: "/code/app" },
  ...over,
});

export const PREVIEW: PublishPreview = {
  post: {
    title: "`feedback` tool error: invalid evidence",
    body: "**Ork** 0.3.0 · **kind** bug\n\n> The tool rejected <project>/x",
    comment: "+1",
    fingerprint: whole(ORK),
  },
  plan: { kind: "create", repo: "R_1", cat: "C_1" },
  repo: "mimshins/ork",
  digest: "digest-1",
};

export type Asked = { route: string; id: string; body: unknown };

export type FeedbackServer = {
  items: FeedbackItem[];
  /** Each item's detail, past what `detailOf` gives. */
  details?: Record<string, Partial<FeedbackDetail>>;
  /** A route's refusal, by name, and its status. */
  refuse?: Record<string, { status: number; error: string }>;
  /** What the publish preview reads, a call at a time. */
  /** A string is a read that fails, with that error. */
  previews?: (PublishPreview | string)[];
  asked: Asked[];
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

const ROUTE =
  /^\/api\/feedback\/([^/]+)(?:\/(status|accept|apply|split|publish\/preview|publish))?$/u;

/** The status a status route asks for. */
const statusIn = (body: unknown): FeedbackItem["status"] =>
  typeof body === "object" &&
  body !== null &&
  "status" in body &&
  body.status === "dismissed"
    ? "dismissed"
    : "new";

const answerTo = (
  server: FeedbackServer,
  route: string,
  found: FeedbackItem,
  body: unknown,
): Response => {
  const id = found.id;
  if (route === "detail") {
    return json(detailOf(found, server.details?.[id.slice(0, 12)]));
  }
  if (route === "status" || route === "accept") {
    const next = route === "accept" ? "accepted" : statusIn(body);
    server.items = server.items.map(other =>
      other.id === id ? { ...other, status: next } : other,
    );
    const changed = server.items.find(other => other.id === id);
    return route === "status"
      ? json(changed)
      : json({
          item: changed,
          lesson: {
            file: ".ork/lessons/review-loop.md",
            root: "/code/app",
            workflow: "review-loop",
            tokens: 455,
          },
        });
  }
  if (route === "apply")
    return json({ runId: "fix11111", root: "/code/app" }, 202);
  if (route === "split") {
    server.items = [
      ...server.items.map(other =>
        other.id === id ? { ...other, merged: [] } : other,
      ),
      item(MERGED, { title: "The loop ran out of rounds" }),
    ];
    return json({ moved: found.merged.length });
  }
  if (route === "publish/preview") {
    const next = server.previews?.shift() ?? PREVIEW;
    return typeof next === "string" ? json({ error: next }, 400) : json(next);
  }
  server.items = server.items.map(other =>
    other.id === id ? { ...other, status: "published" } : other,
  );
  return json({
    item: server.items.find(other => other.id === id),
    url: "https://github.com/mimshins/ork/discussions/41",
    kind: "created",
  });
};

/** The fake server's feedback routes, for `openPanelState`'s `builder` hook. */
export const feedbackRoute =
  (server: FeedbackServer) =>
  (path: string, body: unknown): Response | undefined => {
    const note = /^\/api\/runs\/([^/]+)\/notes$/u.exec(path)?.[1];
    if (note !== undefined) {
      server.asked.push({ route: "note", id: note, body });
      const refusal = server.refuse?.["note"];
      return refusal === undefined
        ? json({ item: whole(LOOP) })
        : json({ error: refusal.error }, refusal.status);
    }
    if (path === "/api/feedback") {
      server.asked.push({ route: "list", id: "", body });
      return json(server.items);
    }
    const [, id = "", named = ""] = ROUTE.exec(path) ?? [];
    if (id === "") return undefined;
    const route = named === "" ? "detail" : named;
    server.asked.push({ route, id: id.slice(0, 12), body });
    const refusal = server.refuse?.[route];
    if (refusal !== undefined) {
      return json({ error: refusal.error }, refusal.status);
    }
    const found = server.items.find(other => other.id === id);
    return found === undefined
      ? json({ error: `No feedback item ${id}.` }, 404)
      : answerTo(server, route, found, body);
  };
