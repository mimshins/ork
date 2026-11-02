/**
 * @file Tests for the event streams: a run's events from the store and then as
 *   they are stored (polling without a socket, pushed with one), resumed after
 *   `Last-Event-ID`, ended with `end`; and the overview stream's runs and
 *   decisions as they change.
 */

import { setTimeout as sleep } from "node:timers/promises";

import { serveRun, socketPath } from "@krapht/ork-core";
import { afterEach, describe, expect, it } from "vitest";

import {
  finished,
  liveRun,
  nodeStarted,
  openGate,
  readSse,
  startTestServer,
  type TestServer,
} from "./fixtures.ts";

let fixture: TestServer | undefined;
const stops: AbortController[] = [];
const sockets: { close: () => Promise<void> }[] = [];

afterEach(async () => {
  for (const stop of stops.splice(0)) stop.abort();
  await Promise.all(sockets.splice(0).map(socket => socket.close()));
  await fixture?.close();
  fixture = undefined;
});

const serve = async (): Promise<TestServer> => {
  fixture = await startTestServer();
  return fixture;
};

const open = async (
  server: TestServer,
  target: string,
  headers: Record<string, string> = {},
) => {
  const stop = new AbortController();
  stops.push(stop);
  const response = await server.get(target, headers);
  return { response, ...readSse(response, stop.signal) };
};

const seqs = (events: { event: string; id?: string }[]) =>
  events.filter(e => e.event === "run-event").map(e => Number(e.id));

describe("a run's stream", () => {
  it("sends the stored events, then each new one, then end", async () => {
    const server = await serve();
    liveRun(server, "r1");
    const stream = await open(server, "/api/runs/r1/stream");
    expect(stream.response.headers.get("content-type")).toContain(
      "text/event-stream",
    );
    await expect.poll(() => seqs(stream.seen)).toEqual([1, 2]);
    server.store.append("r1", nodeStarted("check"));
    server.store.append("r1", finished("r1"));
    await stream.done;
    expect(seqs(stream.seen)).toEqual([1, 2, 3, 4]);
    expect(stream.seen.at(-1)).toEqual({
      event: "end",
      data: { reason: "finished" },
    });
  });

  it("starts after Last-Event-ID, or after", async () => {
    const server = await serve();
    liveRun(server, "r2");
    server.store.append("r2", finished("r2"));
    const resumed = await open(server, "/api/runs/r2/stream", {
      "last-event-id": "2",
    });
    await resumed.done;
    expect(seqs(resumed.seen)).toEqual([3]);
    const after = await open(server, "/api/runs/r2/stream?after=1");
    await after.done;
    expect(seqs(after.seen)).toEqual([2, 3]);
    expect((await server.get("/api/runs/r2/stream?after=x")).status).toBe(400);
    expect((await server.get("/api/runs/nope/stream")).status).toBe(404);
  });

  it("follows the run's socket when it has one", async () => {
    const server = await serve();
    liveRun(server, "r3");
    const followers: number[] = [];
    const socket = await serveRun({
      path: socketPath("r3", server.home),
      onWake: () => {
        // Not under test.
      },
      backlog: after => {
        followers.push(after);
        return server.store.events("r3", after);
      },
    });
    sockets.push(socket);
    const stream = await open(server, "/api/runs/r3/stream");
    await expect.poll(() => seqs(stream.seen)).toEqual([1, 2]);
    await expect.poll(() => followers).toEqual([2]);
    // Stored but not pushed: a stream on the socket does not poll the store.
    const quiet = server.store.append("r3", nodeStarted("check"));
    await sleep(400);
    expect(seqs(stream.seen)).toEqual([1, 2]);
    socket.publish(quiet);
    await expect.poll(() => seqs(stream.seen)).toEqual([1, 2, 3]);
    socket.publish(server.store.append("r3", finished("r3")));
    await stream.done;
    expect(stream.seen.at(-1)).toMatchObject({
      event: "end",
      data: { reason: "finished" },
    });
  });
});

describe("the overview stream", () => {
  it("sends the runs and decisions, and again when they change", async () => {
    const server = await serve();
    liveRun(server, "r4");
    const stream = await open(server, "/api/stream");
    await expect
      .poll(() => stream.seen.map(e => e.event))
      .toEqual(["runs", "decisions"]);
    expect(stream.seen[0]?.data).toMatchObject([{ id: "r4", live: "running" }]);
    expect(stream.seen[1]?.data).toEqual([]);
    openGate(server, "r4", "d1");
    await expect
      .poll(() => stream.seen.map(e => e.event), { timeout: 3000 })
      .toEqual(["runs", "decisions", "decisions"]);
    expect(stream.seen[2]?.data).toMatchObject([
      { id: "d1", question: "Ship it?" },
    ]);
  });
});
