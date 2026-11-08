/**
 * @file Tests for the tools `ork mcp` serves (RFC-012) against a store a run's
 *   process fills: each answers as `ork ui`'s API does, refuses what it can't
 *   find, keeps long values short, and none can act on a run or a decision.
 */

import { afterEach, describe, expect, it } from "vitest";

import { openMcp, type OpenMcp } from "../src/index.ts";
import { shrink } from "../src/mcp-answers.ts";
import {
  finished,
  liveRun,
  openGate,
  startTestServer,
  type TestServer,
} from "./fixtures.ts";

let fixture: TestServer | undefined;
let mcp: OpenMcp | undefined;

afterEach(async () => {
  mcp?.close();
  mcp = undefined;
  await fixture?.close();
  fixture = undefined;
});

/** The tools on a store with a finished run `aaa11111` and a live `bbb22222`. */
const withRuns = async (): Promise<OpenMcp> => {
  fixture = await startTestServer();
  liveRun(fixture, "aaa11111");
  fixture.store.append("aaa11111", finished("aaa11111"));
  liveRun(fixture, "bbb22222");
  openGate(fixture, "bbb22222", "d-live");
  mcp = openMcp({ version: "9.9.9", home: fixture.home, start: false });
  return mcp;
};

const call = (name: string, args: unknown = {}) => {
  const tool = mcp?.tools.find(each => each.name === name);
  if (tool === undefined) throw new Error(`No tool ${name}`);
  return tool.call(args);
};

const parsed = async (name: string, args: unknown = {}): Promise<unknown> =>
  JSON.parse((await call(name, args)).text) as unknown;

describe("ork mcp's tools", () => {
  it("only read and check: none answers, starts, stops, pauses or messages", async () => {
    const { tools } = await withRuns();
    expect(tools.map(({ name }) => name)).toEqual([
      "projects",
      "workflows",
      "workflow_format",
      "agents",
      "runs",
      "run",
      "run_events",
      "usage",
      "decisions",
      "check",
    ]);
  });

  it("lists the projects and a project's workflows", async () => {
    await withRuns();
    expect(await parsed("projects")).toMatchObject([{ id: "demo" }]);
    expect(await parsed("workflows", { project: "demo" })).toMatchObject([
      { name: "demo" },
    ]);
  });

  it("gives runs newest first, and one run with its nodes", async () => {
    await withRuns();
    expect(await parsed("runs", { project: "demo" })).toMatchObject([
      { id: "bbb22222", live: "running" },
      { id: "aaa11111", live: "succeeded" },
    ]);
    expect(await parsed("run", { run: "aaa" })).toMatchObject({
      run: { id: "aaa11111" },
      nodes: [{ id: "lead" }],
    });
  });

  it("refuses a run it can't find, in the API's words", async () => {
    await withRuns();
    expect(await call("run", { run: "zzz" })).toEqual({
      text: expect.stringContaining("zzz") as unknown,
      isError: true,
    });
  });

  it("refuses arguments it doesn't take", async () => {
    await withRuns();
    expect((await call("runs", { limit: -1 })).isError).toBe(true);
    expect((await call("projects", { extra: 1 })).isError).toBe(true);
  });

  it("gives a run's newest events when asked for no range", async () => {
    await withRuns();
    const events = await parsed("run_events", { run: "aaa11111" });
    expect(events).toMatchObject([
      { event: { type: "run.started" } },
      { event: { type: "node.started" } },
      { event: { type: "run.finished" } },
    ]);
    const newest = await parsed("run_events", { run: "aaa11111", last: 1 });
    expect(newest).toMatchObject([{ event: { type: "run.finished" } }]);
    expect(newest).toHaveLength(1);
  });

  it("gives the open decisions, and says only a person answers them", async () => {
    await withRuns();
    expect(await parsed("decisions")).toMatchObject({
      open: [{ id: "d-live" }],
      answer: expect.stringContaining("ork decide") as unknown,
    });
  });

  it("filters the open decisions by workflow", async () => {
    await withRuns();
    expect(await parsed("decisions", { workflow: "gone" })).toMatchObject({
      open: [],
    });
  });

  it("gives the format a part at a time", async () => {
    await withRuns();
    const whole = await parsed("workflow_format");
    expect(whole).toMatchObject({
      properties: {
        nodes: { nodeTypes: expect.arrayContaining(["human.gate"]) as unknown },
      },
    });
    expect(
      await parsed("workflow_format", { nodeType: "human.gate" }),
    ).toMatchObject({
      properties: { type: { const: "human.gate" } },
    });
    expect((await call("workflow_format", { nodeType: "nope" })).isError).toBe(
      true,
    );
  });

  it("cuts long values, and says by how much", () => {
    expect(shrink({ a: ["x".repeat(10)] }, 4)).toEqual({
      a: ["xxxx… (6 more characters)"],
    });
  });
});
