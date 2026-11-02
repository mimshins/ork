/**
 * @file Tests for pausing, continuing and stopping a run or one node through
 *   the API (ADR-041): each becomes the run's command and wakes it, a run
 *   paused as a whole shows `live: "paused"`, a refusal has the CLI's words
 *   (404 for an unknown node, 409 for the wrong state), and a project's
 *   workflows are listed for starting a run.
 */

import { writeFileSync } from "node:fs";
import path from "node:path";

import { serveRun, socketPath } from "@krapht/ork-core";
import { afterEach, describe, expect, it } from "vitest";

import { liveRun, startTestServer, type TestServer, text } from "./fixtures.ts";

let fixture: TestServer | undefined;
const sockets: { close: () => Promise<void> }[] = [];

afterEach(async () => {
  await Promise.all(sockets.splice(0).map(socket => socket.close()));
  await fixture?.close();
  fixture = undefined;
});

/** A server with a live run `live1234` whose `lead` runs, and its wakes. */
const withLiveRun = async () => {
  fixture = await startTestServer();
  liveRun(fixture, "live1234");
  const wakes: number[] = [];
  sockets.push(
    await serveRun({
      path: socketPath("live1234", fixture.home),
      onWake: () => {
        wakes.push(Date.now());
      },
      backlog: () => [],
    }),
  );
  return { server: fixture, wakes };
};

describe("pause and continue", () => {
  it("queue the run's command and wake it, and the run shows paused", async () => {
    const { server, wakes } = await withLiveRun();
    const id = { params: { id: "live1234" } };
    expect(await server.client.call("pause", id)).toEqual({
      ok: true,
      status: 202,
      data: { runId: "live1234" },
    });
    expect(server.store.takeCommands("live1234")).toEqual([{ kind: "pause" }]);
    await expect.poll(() => wakes.length).toBe(1);
    // The run records the command once it pauses.
    server.store.append("live1234", { type: "run.command", command: "pause" });
    expect(await server.client.call("run", id)).toMatchObject({
      data: { live: "paused", paused: { run: true, nodes: [] } },
    });
    expect(await server.client.call("pause", id)).toMatchObject({
      status: 409,
      error: "Run live1234 is already paused.",
    });
    expect(
      await server.client.call("continue", { ...id, body: { node: "lead" } }),
    ).toMatchObject({
      status: 409,
      error: "Run live1234 is paused as a whole; continue the run, not lead.",
    });
    expect(await server.client.call("continue", id)).toMatchObject({
      status: 202,
    });
    expect(server.store.takeCommands("live1234")).toEqual([
      { kind: "continue" },
    ]);
  });

  it("pause one node by name, and refuse one the run does not have", async () => {
    const { server } = await withLiveRun();
    const pause = (node: string) =>
      server.client.call("pause", {
        params: { id: "live1234" },
        body: { node },
      });
    expect(await pause("lead")).toMatchObject({ status: 202 });
    expect(server.store.takeCommands("live1234")).toEqual([
      { kind: "pause", node: "lead" },
    ]);
    expect(await pause("ghost")).toMatchObject({
      status: 404,
      error: "ghost is not a node of run live1234.",
    });
  });
});

describe("stopping one node", () => {
  it("queues the stop for a running node, and refuses one that is not running", async () => {
    const { server } = await withLiveRun();
    const stop = (node: string) =>
      server.client.call("stop", {
        params: { id: "live1234" },
        body: { node },
      });
    expect(await stop("lead")).toMatchObject({ status: 202 });
    expect(server.store.takeCommands("live1234")).toEqual([
      { kind: "stop", node: "lead" },
    ]);
    expect(await stop("check")).toMatchObject({
      status: 409,
      error: "check is not running in run live1234.",
    });
  });
});

describe("a project's workflows", () => {
  it("lists each with its name and inputs, and one that does not parse with why", async () => {
    fixture = await startTestServer();
    const folder = path.join(fixture.project.dir, "workflows");
    writeFileSync(
      path.join(folder, "brief.ork.yaml"),
      [
        "schemaVersion: 1",
        "name: brief",
        "description: Write a brief",
        "inputs:",
        "  topic: { type: string, required: true }",
        "nodes:",
        '  say: { type: tool.shell, command: "echo hi" }',
        "",
      ].join("\n"),
    );
    writeFileSync(path.join(folder, "broken.ork.yaml"), "nodes: [\n");
    writeFileSync(path.join(folder, "notes.md"), "# not a workflow");
    const listed = await fixture.client.call("workflows", {
      params: { id: "demo" },
    });
    expect(listed).toMatchObject({
      ok: true,
      data: [
        {
          name: "brief",
          title: "brief",
          description: "Write a brief",
          inputs: { topic: { type: "string", required: true } },
        },
        { name: "broken", inputs: {}, error: text("") },
        { name: "demo", inputs: {}, error: "a workflow needs nodes" },
      ],
    });
    expect(
      await fixture.client.call("workflows", { params: { id: "nope" } }),
    ).toMatchObject({ status: 404, error: 'No registered project "nope".' });
  });
});
