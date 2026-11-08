/**
 * @file Tests for the API's read routes against a store a run's process fills:
 *   projects, runs with their live status, a run by prefix, its tree and
 *   events, the open decisions of live runs, triggers, and the refusals.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { readProjectTriggers } from "@krapht/ork-core";
import { afterEach, describe, expect, it } from "vitest";

import {
  finished,
  liveRun,
  openGate,
  startTestServer,
  type TestServer,
  text,
} from "./fixtures.ts";

let fixture: TestServer | undefined;

afterEach(async () => {
  await fixture?.close();
  fixture = undefined;
});

/** A server whose store has a finished run `aaa11111` and a live `bbb22222`. */
const withRuns = async (): Promise<TestServer> => {
  fixture = await startTestServer();
  liveRun(fixture, "aaa11111");
  fixture.store.append("aaa11111", finished("aaa11111"));
  liveRun(fixture, "bbb22222");
  openGate(fixture, "bbb22222", "d-live");
  openGate(fixture, "aaa11111", "d-done");
  return fixture;
};

/** A server whose project declares a trigger `t`, and `bad` with no workflow. */
const withTriggers = async (): Promise<TestServer> => {
  fixture = await startTestServer();
  const { dir } = fixture.project;
  writeFileSync(
    path.join(dir, "workflows", "triage.ork.yaml"),
    "schemaVersion: 1\nname: triage\nnodes:\n  a: { type: tool.shell, command: x }\nlimits: { budgetUsd: 1 }\n",
  );
  writeFileSync(
    path.join(dir, "triggers.yaml"),
    "schemaVersion: 1\ntriggers:\n  t: { every: 1m, run: triage }\n  bad: { every: 1m, run: gone }\n",
  );
  return fixture;
};

/** Accepts `t` in the store, as `ork watch --accept` would. */
const acceptT = ({ project, store }: TestServer): void => {
  const item = readProjectTriggers(project).triggers.find(
    ({ id }) => id === "t",
  );
  if (item === undefined) throw new Error("no trigger t");
  store.acceptTrigger(project.id, item.id, item.hash);
};

describe("GET /api/triggers", () => {
  it("is empty for a project that declares none", async () => {
    fixture = await startTestServer();
    const response = await fixture.get("/api/triggers");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ triggers: [], broken: [] });
  });

  it("reports how each stands, read from the project's file and the store", async () => {
    const { client } = await withTriggers();
    expect(await client.call("triggers")).toMatchObject({
      ok: true,
      data: {
        broken: [],
        triggers: [
          {
            project: "demo",
            trigger: "t",
            run: "triage",
            every: "1m",
            standing: "new",
            problems: [],
          },
          { project: "demo", trigger: "bad", standing: "invalid" },
        ],
      },
    });
  });

  it("says a trigger someone accepted is live", async () => {
    const given = await withTriggers();
    acceptT(given);
    expect(await given.client.call("triggers")).toMatchObject({
      ok: true,
      data: { triggers: [{ trigger: "t", standing: "live" }, {}] },
    });
  });

  it("says a file it can't read is broken, rather than failing", async () => {
    fixture = await startTestServer();
    const file = path.join(fixture.project.dir, "triggers.yaml");
    mkdirSync(file);
    expect(await fixture.client.call("triggers")).toMatchObject({
      ok: true,
      data: { triggers: [], broken: [{ project: "demo", file }] },
    });
    rmSync(file, { recursive: true });
  });
});

describe("the read routes", () => {
  it("report usage from the ledger, by project and time", async () => {
    fixture = await startTestServer();
    const { client, project, store } = fixture;
    liveRun(fixture, "aaa11111");
    store.append("aaa11111", {
      type: "node.event",
      id: "n",
      event: {
        type: "session.finished",
        outcome: {
          subtype: "success",
          sessionId: "s",
          report: null,
          text: "",
          usage: {
            costUsd: 0.5,
            inputTokens: 1,
            outputTokens: 1,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            turns: 1,
            durationMs: 1,
          },
          errors: [],
        },
      },
    });
    expect(
      await client.call("usage", { query: { project: "demo" } }),
    ).toMatchObject({ ok: true, data: { totals: { costUsd: 0.5, runs: 1 } } });
    expect(
      await client.call("usage", { query: { project: project.root } }),
    ).toMatchObject({ ok: true, data: { totals: { sessions: 1 } } });
    expect(
      await client.call("usage", {
        query: { since: "2999-01-01T00:00:00.000Z" },
      }),
    ).toMatchObject({ ok: true, data: { totals: { sessions: 0 } } });
    expect(
      await client.call("usage", { query: { since: "yesterday" } }),
    ).toMatchObject({ ok: false, status: 400 });
  });

  it("list the registered projects", async () => {
    const { client, project } = await withRuns();
    expect(await client.call("projects")).toMatchObject({
      ok: true,
      data: [{ id: "demo", root: project.root }],
    });
  });

  it("list runs newest first with their live status, by project id or root", async () => {
    const { client, project } = await withRuns();
    const all = await client.call("runs");
    expect(all).toMatchObject({
      ok: true,
      data: [
        { id: "bbb22222", live: "running" },
        { id: "aaa11111", live: "succeeded" },
      ],
    });
    expect(
      await client.call("runs", { query: { project: "demo", limit: 1 } }),
    ).toMatchObject({ data: [{ id: "bbb22222" }] });
    expect(
      await client.call("runs", { query: { project: project.root } }),
    ).toMatchObject({ data: { length: 2 } });
    expect(
      await client.call("runs", { query: { project: "/elsewhere" } }),
    ).toMatchObject({ data: [] });
  });

  it("find a run by a unique prefix, with 404 and 400 otherwise", async () => {
    const { client } = await withRuns();
    expect(await client.call("run", { params: { id: "bbb" } })).toMatchObject({
      ok: true,
      data: { id: "bbb22222" },
    });
    expect(await client.call("run", { params: { id: "zzz" } })).toEqual({
      ok: false,
      status: 404,
      error: "No run `zzz`.",
    });
    fixture?.store.begin({
      id: "bbb33333",
      workflow: "demo",
      file: "/x",
      project: "/x",
    });
    expect(await client.call("run", { params: { id: "bbb" } })).toMatchObject({
      ok: false,
      status: 400,
      error: "`bbb` matches 2 runs: bbb33333, bbb22222",
    });
  });

  it("give the graph a run recorded", async () => {
    const { client, store } = await withRuns();
    store.append("aaa11111", {
      type: "run.started",
      runId: "aaa11111",
      workflow: "w",
      entries: ["lead"],
      nodes: [{ id: "lead", type: "claude.leader" }],
      edges: [{ from: "lead", to: "lead", maxRounds: 2 }],
      channels: [],
    });
    expect(
      await client.call("graph", { params: { id: "aaa11111" } }),
    ).toMatchObject({
      ok: true,
      data: {
        nodes: [{ id: "lead", type: "claude.leader" }],
        edges: [{ from: "lead", to: "lead", maxRounds: 2 }],
        channels: [],
      },
    });
  });

  it("give a run's tree and its events, by node and after a seq", async () => {
    const { client } = await withRuns();
    expect(
      await client.call("tree", { params: { id: "aaa11111" } }),
    ).toMatchObject({
      ok: true,
      data: [{ id: "lead", children: [{ id: "check" }] }],
    });
    const events = await client.call("events", { params: { id: "aaa11111" } });
    expect(events).toMatchObject({ ok: true, data: { length: 3 } });
    expect(
      await client.call("events", {
        params: { id: "aaa11111" },
        query: { after: 1, limit: 1 },
      }),
    ).toMatchObject({
      data: [{ seq: 2, event: { type: "node.started", id: "lead" } }],
    });
    expect(
      await client.call("events", {
        params: { id: "aaa11111" },
        query: { node: "lead" },
      }),
    ).toMatchObject({ data: { length: 1 } });
    const newest = await client.call("events", {
      params: { id: "aaa11111" },
      query: { last: 2 },
    });
    expect(newest).toMatchObject({ data: [{ seq: 2 }, { seq: 3 }] });
  });

  it("list only the open decisions of live runs", async () => {
    const { client } = await withRuns();
    expect(await client.call("decisions")).toMatchObject({
      ok: true,
      data: [{ id: "d-live", runId: "bbb22222" }],
    });
    expect(
      await client.call("decisions", { query: { run: "aaa" } }),
    ).toMatchObject({ data: [] });
    expect(
      await client.call("decisions", { query: { project: "demo" } }),
    ).toMatchObject({ data: { length: 1 } });
  });

  it("filter the open decisions by workflow, ANDed with the run", async () => {
    const { client } = await withRuns();
    expect(
      await client.call("decisions", { query: { workflow: "demo" } }),
    ).toMatchObject({ data: [{ id: "d-live" }] });
    expect(
      await client.call("decisions", { query: { workflow: "gone" } }),
    ).toMatchObject({ data: [] });
    expect(
      await client.call("decisions", {
        query: { run: "bbb", workflow: "gone" },
      }),
    ).toMatchObject({ data: [] });
  });

  it("return a decision's document, and no key when it has none", async () => {
    const server = await withRuns();
    server.store.openDecision({
      id: "d-doc",
      runId: "bbb22222",
      node: "lead",
      kind: "question",
      question: "Ship it?",
      options: [{ id: "ship" }],
      document: "# The spec",
    });
    const { client } = server;
    expect(
      await client.call("decision", { params: { id: "d-doc" } }),
    ).toMatchObject({ data: { document: "# The spec" } });
    expect(await client.call("decisions")).toMatchObject({
      data: [{ id: "d-live" }, { document: "# The spec" }],
    });
    const plain = await client.call("decision", { params: { id: "d-live" } });
    expect(plain).toMatchObject({ ok: true });
    expect(JSON.stringify(plain)).not.toContain('"document"');
  });

  it("read one decision, open or not, and refuse an unknown one", async () => {
    const { client } = await withRuns();
    expect(
      await client.call("decision", { params: { id: "d-live" } }),
    ).toMatchObject({ ok: true, data: { id: "d-live", status: "open" } });
    expect(
      await client.call("decision", { params: { id: "nope" } }),
    ).toMatchObject({ ok: false, status: 404 });
  });

  it("refuse a bad query, and a method a path does not take", async () => {
    const { get, server } = await withRuns();
    const bad = await get("/api/runs?limit=many");
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({
      error: text("limit"),
    });
    expect((await get("/api/runs?colour=red")).status).toBe(400);
    const wrong = await fetch(`${server.url}/api/health`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${server.token}`,
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(wrong.status).toBe(405);
  });
});
