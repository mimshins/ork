/**
 * @file Tests for the API's write routes: an answer goes to the store as the
 *   UI's and wakes the run; stop and a message become the run's commands; a
 *   start or a resume runs `ork` in the background with the request's flags;
 *   and each refusal has the CLI's words.
 */

import path from "node:path";

import { serveRun, socketPath } from "@krapht/ork-core";
import { afterEach, describe, expect, it } from "vitest";

import {
  finished,
  liveRun,
  openGate,
  runIdOf,
  startTestServer,
  type TestServer,
  text,
} from "./fixtures.ts";

let fixture: TestServer | undefined;
const sockets: { close: () => Promise<void> }[] = [];

afterEach(async () => {
  await Promise.all(sockets.splice(0).map(socket => socket.close()));
  await fixture?.close();
  fixture = undefined;
});

/** A server with a live run `live1234` listening on its socket. */
const withLiveRun = async () => {
  fixture = await startTestServer();
  liveRun(fixture, "live1234");
  const wakes: number[] = [];
  const socket = await serveRun({
    path: socketPath("live1234", fixture.home),
    onWake: () => {
      wakes.push(Date.now());
    },
    backlog: () => [],
  });
  sockets.push(socket);
  return { server: fixture, wakes };
};

/** A run that ended with `status`, not live. */
const endedRun = (
  server: TestServer,
  id: string,
  status: "succeeded" | "failed",
) => {
  liveRun(server, id);
  server.store.append(id, finished(id, status));
};

describe("answering a decision", () => {
  it("records the UI's answer and wakes the run", async () => {
    const { server, wakes } = await withLiveRun();
    openGate(server, "live1234", "d1");
    expect(
      await server.client.call("answer", {
        params: { id: "d1" },
        body: { choose: "ship" },
      }),
    ).toEqual({
      ok: true,
      status: 200,
      data: { decision: "d1", answer: "ship" },
    });
    expect(server.store.decision("d1")).toMatchObject({
      status: "answered",
      answer: "ship",
      answeredBy: "ui",
    });
    await expect.poll(() => wakes.length).toBe(1);
  });

  it("refuses an unknown decision, an option it does not have, and a second answer", async () => {
    const { server } = await withLiveRun();
    openGate(server, "live1234", "d2");
    const answer = (id: string, choose: string) =>
      server.client.call("answer", { params: { id }, body: { choose } });
    expect(await answer("nope", "ship")).toMatchObject({
      ok: false,
      status: 404,
      error: "No decision `nope`.",
    });
    expect(await answer("d2", "maybe")).toMatchObject({
      ok: false,
      status: 400,
      error: "`maybe` is not an option of `d2`: `ship`, `hold`",
    });
    await answer("d2", "hold");
    expect(await answer("d2", "ship")).toMatchObject({
      ok: false,
      status: 409,
      error: "d2 was already answered: hold (ui)",
    });
  });
});

describe("stopping and messaging a run", () => {
  it("queues a stop for a live run and wakes it, and refuses one that ended", async () => {
    const { server, wakes } = await withLiveRun();
    expect(
      await server.client.call("stop", { params: { id: "live" } }),
    ).toEqual({ ok: true, status: 202, data: { runId: "live1234" } });
    expect(server.store.takeCommands("live1234")).toEqual([{ kind: "stop" }]);
    await expect.poll(() => wakes.length).toBe(1);
    endedRun(server, "done1234", "succeeded");
    expect(
      await server.client.call("stop", { params: { id: "done1234" } }),
    ).toMatchObject({
      status: 409,
      error: "Run done1234 is not running (succeeded).",
    });
  });

  it("sends a live run's leader a message, and refuses other nodes and ended runs", async () => {
    const { server } = await withLiveRun();
    const say = (id: string, node: string) =>
      server.client.call("message", {
        params: { id },
        body: { node, body: "hello" },
      });
    expect(await say("live1234", "lead")).toMatchObject({
      status: 202,
      data: { runId: "live1234" },
    });
    expect(server.store.takeCommands("live1234")).toEqual([
      { kind: "message", node: "lead", body: "hello" },
    ]);
    expect(await say("live1234", "check")).toMatchObject({
      status: 400,
      error: text("not a leader or worker"),
    });
    expect(await say("live1234", "ghost")).toMatchObject({
      status: 404,
      error: "ghost is not a node of run live1234.",
    });
    endedRun(server, "done1234", "succeeded");
    expect(await say("done1234", "lead")).toMatchObject({
      status: 409,
      error: text("use `ork chat done1234 lead`"),
    });
  });
});

describe("starting and resuming a run", () => {
  it("starts a project's workflow in the background with the request's flags", async () => {
    fixture = await startTestServer();
    const started = await fixture.client.call("start", {
      body: {
        project: "demo",
        workflow: "demo",
        inputs: { topic: "a b" },
        driver: "cli",
        inPlace: true,
        allowDirty: true,
      },
    });
    expect(started).toMatchObject({ ok: true, status: 202 });
    const runId = runIdOf(started);
    expect(fixture.lastArgs()).toEqual({
      argv: [
        "run",
        path.join(fixture.project.dir, "workflows", "demo.ork.yaml"),
        "--input",
        "topic=a b",
        "--driver",
        "cli",
        "--in-place",
        "--allow-dirty",
        "--run-id",
        runId,
      ],
      cwd: fixture.project.root,
      detached: "1",
    });
    expect(
      await fixture.client.call("run", { params: { id: runId } }),
    ).toMatchObject({ ok: true, data: { id: runId } });
  });

  it("refuses an unknown project, a missing workflow, and one outside the project", async () => {
    const server = await startTestServer();
    fixture = server;
    const start = (project: string, workflow: string) =>
      server.client.call("start", { body: { project, workflow } });
    expect(await start("nope", "demo")).toMatchObject({
      status: 404,
      error: text("No registered project `nope`"),
    });
    expect(await start("demo", "missing")).toMatchObject({
      status: 404,
      error: text("No workflow `missing`"),
    });
    expect(await start("demo", "../../../etc/hosts")).toMatchObject({
      status: 404,
    });
    const extra = await server.get("/api/health");
    expect(extra.status).toBe(200);
  });

  it("checks a request's body against the contract", async () => {
    const server = await startTestServer();
    fixture = server;
    const post = (body: string) =>
      fetch(`${server.server.url}/api/runs`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${server.server.token}`,
          "content-type": "application/json",
        },
        body,
      });
    const unknown = await post(
      JSON.stringify({ project: "demo", workflow: "demo", colour: "red" }),
    );
    expect(unknown.status).toBe(400);
    expect((await post("{ nope")).status).toBe(400);
  });

  it("resumes a run that failed with the request's flags, and refuses one that succeeded or runs", async () => {
    const { server } = await withLiveRun();
    endedRun(server, "fail1234", "failed");
    endedRun(server, "done1234", "succeeded");
    expect(
      await server.client.call("resume", {
        params: { id: "fail1234" },
        body: { inPlace: false },
      }),
    ).toEqual({
      ok: true,
      status: 202,
      data: { runId: "fail1234" },
    });
    expect(server.lastArgs()).toMatchObject({
      argv: ["resume", "fail1234", "--no-in-place"],
      cwd: server.project.root,
    });
    expect(
      await server.client.call("resume", {
        params: { id: "done1234" },
        body: {},
      }),
    ).toMatchObject({
      status: 409,
      error: "Run done1234 succeeded; there is nothing to resume.",
    });
    expect(
      await server.client.call("resume", {
        params: { id: "live1234" },
        body: {},
      }),
    ).toMatchObject({
      status: 409,
      error: "Run live1234 is still running.",
    });
  });
});
