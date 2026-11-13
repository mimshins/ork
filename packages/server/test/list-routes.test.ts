/**
 * @file Tests for the list routes' filters (RFC-017, ADR-088): each route takes
 *   its core table's fields by flag name with the CLI's value forms, answers a
 *   wrong value as 400 in the CLI's words, keeps its old params and defaults,
 *   and matches `status` on a run's live status. A walk over every table field
 *   holds each route to its table, as `list-filters.test.ts` does the CLI.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  changeFollowUp,
  followUpStore,
  humanNoteEvent,
  LIST_TABLES,
  type ListField,
  type ListFieldType,
  storePath,
} from "@krapht/ork-core";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  finished,
  liveRun,
  openGate,
  spend,
  startTestServer,
  temp,
  type TestServer,
} from "./fixtures.ts";

let fixture: TestServer | undefined;

afterEach(async () => {
  await fixture?.close();
  fixture = undefined;
});

/** Finished `aaa11111`, live `bbb22222`, paused `ccc33333`, crashed `ddd44444`. */
const seeded = async (): Promise<TestServer> => {
  fixture = await startTestServer();
  liveRun(fixture, "aaa11111");
  fixture.store.append("aaa11111", finished("aaa11111"));
  liveRun(fixture, "bbb22222");
  openGate(fixture, "bbb22222", "d-live");
  liveRun(fixture, "ccc33333");
  fixture.store.append("ccc33333", { type: "run.command", command: "pause" });
  liveRun(fixture, "ddd44444");
  const db = new DatabaseSync(storePath(fixture.home));
  db.prepare("UPDATE runs SET pid = ? WHERE id = ?").run(
    spawnSync("true").pid,
    "ddd44444",
  );
  db.close();
  return fixture;
};

/** The ids a `GET` of `target` answers with, newest first. */
const idsOf = async (server: TestServer, target: string): Promise<string[]> => {
  const body = z
    .array(z.object({ id: z.string() }))
    .parse(await (await server.get(target)).json());
  return body.map(run => run.id);
};

/** The titles a `GET` of `target` answers with (inside `key`, when given). */
const titlesAt = async (
  server: TestServer,
  target: string,
  key?: string,
): Promise<string[]> => {
  const json: unknown = await (await server.get(target)).json();
  const list =
    key === undefined
      ? json
      : z.looseObject({ [key]: z.unknown() }).parse(json)[key];
  return z
    .array(z.object({ title: z.string() }))
    .parse(list)
    .map(item => item.title);
};

describe("GET /api/runs filters", () => {
  it("matches status on the live status: paused and crashed too", async () => {
    const server = await seeded();
    expect(await idsOf(server, "/api/runs?status=paused")).toEqual([
      "ccc33333",
    ]);
    expect(await idsOf(server, "/api/runs?status=crashed")).toEqual([
      "ddd44444",
    ]);
    expect(await idsOf(server, "/api/runs?status=running")).toEqual([
      "bbb22222",
    ]);
    expect(await idsOf(server, "/api/runs?status=succeeded")).toEqual([
      "aaa11111",
    ]);
    expect(await idsOf(server, "/api/runs?status=all")).toHaveLength(4);
  });

  it("filters by workflow, project and time, then limits", async () => {
    const server = await seeded();
    expect(await idsOf(server, "/api/runs?workflow=gone")).toEqual([]);
    expect(await idsOf(server, "/api/runs?workflow=demo&limit=2")).toEqual([
      "ddd44444",
      "ccc33333",
    ]);
    expect(
      await idsOf(server, "/api/runs?project=demo&since=24h"),
    ).toHaveLength(4);
    expect(await idsOf(server, "/api/runs?project=all")).toHaveLength(4);
    expect(await idsOf(server, "/api/runs?until=2000-01-01")).toEqual([]);
    expect(await idsOf(server, "/api/runs?since=2999-01-01T00:00:00Z")).toEqual(
      [],
    );
  });

  it("keeps the default: the 20 newest", async () => {
    const server = await seeded();
    expect(await idsOf(server, "/api/runs")).toHaveLength(4);
    expect(await idsOf(server, "/api/runs?limit=1")).toEqual(["ddd44444"]);
    for (let i = 0; i < 18; i += 1) {
      liveRun(server, `eee${String(i).padStart(5, "0")}`);
    }
    const newest = await idsOf(server, "/api/runs");
    expect(newest).toHaveLength(20);
    expect(newest).not.toContain("aaa11111");
    expect(await idsOf(server, "/api/runs?limit=22")).toHaveLength(22);
  });

  it("refuses a wrong value in the CLI's words", async () => {
    const server = await seeded();
    const response = await server.get("/api/runs?status=nope");
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("--status takes one of") as unknown,
    });
  });
});

describe("GET /api/decisions, /api/usage filters", () => {
  it("filters decisions by workflow and run", async () => {
    const server = await seeded();
    expect(await idsOf(server, "/api/decisions?workflow=demo")).toEqual([
      "d-live",
    ]);
    expect(await idsOf(server, "/api/decisions?workflow=gone")).toEqual([]);
    expect(await idsOf(server, "/api/decisions?run=bbb")).toEqual(["d-live"]);
    expect((await server.get("/api/decisions?run=zzz")).status).toBe(404);
  });

  it("takes an age or a day, and still an ISO time, for since and until", async () => {
    const server = await seeded();
    spend(server, "aaa11111", 0.5);
    const sessions = async (query: string): Promise<number> =>
      z
        .object({ totals: z.object({ sessions: z.number() }) })
        .parse(await (await server.get(`/api/usage?${query}`)).json()).totals
        .sessions;
    // A session ended just now: it is in what these ask for, and out of the rest.
    for (const [query, count] of [
      ["since=24h", 1],
      ["since=30d", 1],
      ["since=all", 1],
      ["since=30d&until=2999-01-01", 1],
      ["since=2000-01-01", 1],
      ["since=2000-01-01T00:00:00.000Z&until=2999-01-01T00:00:00.000Z", 1],
      ["until=2000-01-01", 0],
      ["since=2999-01-01", 0],
      ["since=2999-01-01T00:00:00.000Z", 0],
      ["since=30d&until=2000-01-01", 0],
    ] as const) {
      // oxlint-disable-next-line no-await-in-loop -- one request at a time
      expect([query, await sessions(query)]).toEqual([query, count]);
    }
    expect((await server.get("/api/usage?since=yesterday")).status).toBe(400);
    expect((await server.get("/api/usage?since=0d")).status).toBe(400);
  });
});

const titlesOf = (server: TestServer, query: string) =>
  titlesAt(server, `/api/projects/demo/follow-ups${query}`, "followUps");

describe("GET /api/projects/:id/follow-ups filters", () => {
  it("filters by kind, for and due, and takes open and all", async () => {
    const server = await seeded();
    const store = followUpStore({
      rows: server.store,
      project: server.project.root,
      home: server.home,
    });
    await store.add({ title: "A", for: "agent", kind: "change", due: "now" });
    await store.add({ title: "B", for: "me", kind: "task", due: "2999-01-01" });
    const closed = await store.add({
      title: "C",
      for: "me",
      kind: "task",
      due: "now",
    });
    changeFollowUp(server.store, closed.followUp, "done");
    expect(await titlesOf(server, "")).toEqual(["A", "B"]);
    expect(await titlesOf(server, "?kind=change")).toEqual(["A"]);
    expect(await titlesOf(server, "?for=me")).toEqual(["B"]);
    expect(await titlesOf(server, "?due=date")).toEqual(["B"]);
    expect(await titlesOf(server, "?status=open")).toEqual(["A", "B"]);
    expect(await titlesOf(server, "?status=all")).toEqual(["A", "B", "C"]);
    expect(await titlesOf(server, "?project=all&kind=task")).toEqual(["B"]);
    expect(await titlesOf(server, "?project=/elsewhere")).toEqual([]);
  });
});

describe("GET /api/feedback filters", () => {
  it("lists every item, and filters by kind and severity", async () => {
    const server = await seeded();
    server.store.append(
      "aaa11111",
      humanNoteEvent({
        text: "Vague brief",
        workflow: "demo",
        kind: "friction",
      }),
    );
    server.store.append(
      "aaa11111",
      humanNoteEvent({ text: "It crashed", workflow: "demo", kind: "bug" }),
    );
    const titles = (query: string) => titlesAt(server, `/api/feedback${query}`);
    expect(await titles("")).toHaveLength(2);
    expect(await titles("?kind=bug")).toEqual(["It crashed"]);
    expect(await titles("?run=aaa11111&workflow=demo")).toHaveLength(2);
    expect(await titles("?status=dismissed")).toEqual([]);
    expect(await titles("?workflow=gone")).toEqual([]);
  });

  it("filters by severity and by status, dismissed items included on all", async () => {
    const server = await seeded();
    for (const [text, severity] of [
      ["Slow", "low"],
      ["Wrong", "high"],
      ["Odd", "high"],
    ] as const) {
      server.store.append(
        "aaa11111",
        humanNoteEvent({ text, workflow: "demo", kind: "bug", severity }),
      );
    }
    const titles = async (query: string) =>
      (await titlesAt(server, `/api/feedback${query}`)).toSorted();
    for (const item of server.store
      .feedbackItems({ all: true })
      .filter(each => each.title === "Odd")) {
      server.store.setFeedbackStatus(item.id, "dismissed");
    }
    expect(await titles("?severity=high")).toEqual(["Odd", "Wrong"]);
    expect(await titles("?severity=low")).toEqual(["Slow"]);
    expect(await titles("?severity=medium")).toEqual([]);
    expect(await titles("?status=dismissed")).toEqual(["Odd"]);
    expect(await titles("?status=new")).toEqual(["Slow", "Wrong"]);
    expect(await titles("?status=all")).toEqual(["Odd", "Slow", "Wrong"]);
    expect(await titles("?status=new&severity=high")).toEqual(["Wrong"]);
  });
});

describe("GET /api/worktrees filters", () => {
  it("filters a project's worktrees by run", async () => {
    fixture = await startTestServer();
    const base = temp("ork-srv-wtl-");
    const root = path.join(base, "app");
    mkdirSync(root);
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: root, encoding: "utf8" });
    git("init", "-q", "-b", "main");
    git("config", "user.email", "dev@example.com");
    git("config", "user.name", "Dev");
    git("config", "commit.gpgsign", "false");
    writeFileSync(path.join(root, "a.ts"), "a\n");
    git("add", "-A");
    git("commit", "-q", "-m", "init");
    const lead = path.join(base, "ork-r1-lead");
    git("worktree", "add", "--quiet", "-b", "ork/r1/lead", lead);
    fixture.store.addProject({ id: "app", root, mode: "attached", dir: base });
    fixture.store.begin({
      id: "r1",
      workflow: "demo",
      file: "/w.ork.yaml",
      project: root,
    });
    fixture.store.append("r1", {
      type: "worktree",
      id: "lead",
      action: "created",
      path: lead,
      branch: "ork/r1/lead",
    });
    const keys = async (query: string) => {
      const body = z
        .object({
          projects: z.array(
            z.object({ items: z.array(z.object({ key: z.string() })) }),
          ),
        })
        .parse(await (await fixture?.get(`/api/worktrees${query}`))?.json());
      return body.projects.flatMap(p => p.items.map(item => item.key));
    };
    expect(await keys("")).toEqual(["ork/r1/lead"]);
    expect(await keys("?run=r1&project=app")).toEqual(["ork/r1/lead"]);
    expect(await keys("?run=r2")).toEqual([]);
    expect((await fixture.get("/api/worktrees?project=nowhere")).status).toBe(
      404,
    );
  });
});

/** The core tables the six list routes read, with each one's route. */
const ROUTES = [
  ["/api/runs", LIST_TABLES.ps],
  ["/api/decisions", LIST_TABLES["decide --list"]],
  ["/api/usage", LIST_TABLES.usage],
  ["/api/projects/demo/follow-ups", LIST_TABLES["follow-ups list"]],
  ["/api/feedback", LIST_TABLES["feedback list"]],
  ["/api/worktrees", LIST_TABLES["worktrees list"]],
] as const;

/** A value the field takes (a run's id is the one a store has). */
const takes = (field: ListField<never>): string => {
  const byName: Record<string, string> = { project: "all", run: "aaa11111" };
  const byType: Record<string, string> = {
    enum: field.values?.[0] ?? "",
    text: "demo",
    for: "agent",
    since: "24h",
    until: "2026-11-01",
  };
  return byName[field.name] ?? byType[field.type] ?? "";
};

/** A value the field's type refuses; none for a text. */
const refused = (field: ListField<never>): string | undefined => {
  const wrong: Record<ListFieldType, string | undefined> = {
    enum: "x",
    for: "x",
    since: "yesterday",
    until: "soon",
    text: undefined,
  };
  return wrong[field.type];
};

describe("every route takes every field of its core table", () => {
  const fields = ROUTES.flatMap(([route, table]) =>
    table.fields.map(field => [route, field.name, field] as const),
  );

  it.each(fields)("%s takes ?%s=", async (route, name, field) => {
    const server = await seeded();
    const response = await server.get(`${route}?${name}=${takes(field)}`);
    expect(response.status).toBe(200);
  });

  it.each(fields.filter(([, , field]) => field.type !== "text"))(
    "%s refuses a wrong ?%s= in the CLI's words",
    async (route, name, field) => {
      const server = await seeded();
      const response = await server.get(`${route}?${name}=${refused(field)}`);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: expect.stringContaining(`--${name} takes`) as unknown,
      });
    },
  );
});

/** A table's fields as the route should serve them: text, no functions. */
const served = (table: { fields: readonly ListField<never>[] }) =>
  table.fields.map(({ name, description, type, values, all }) => ({
    name,
    description,
    type,
    ...(values === undefined ? {} : { values: [...values] }),
    ...(all === true ? { all: true } : {}),
  }));

describe("GET /api/list-fields", () => {
  it("serves every list's core table fields over HTTP", async () => {
    const server = await seeded();
    const response = await server.get("/api/list-fields");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      runs: served(LIST_TABLES.ps),
      feedback: served(LIST_TABLES["feedback list"]),
      "follow-ups": served(LIST_TABLES["follow-ups list"]),
      decisions: served(LIST_TABLES["decide --list"]),
      worktrees: served(LIST_TABLES["worktrees list"]),
      usage: served(LIST_TABLES.usage),
    });
  });
});
