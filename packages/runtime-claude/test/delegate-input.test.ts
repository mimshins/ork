/**
 * @file Tests for what a leader may pass to `delegate` and `spawn_worker`: the
 *   ids it knows as enums on both drivers, and errors a model can act on.
 */

import type {
  HumanChannel,
  Ownership,
  SessionPorts,
  SessionSpec,
} from "@krapht/ork-core";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { buildSdkOptions, handleRpc, orkTools } from "../src/index.ts";

const human: HumanChannel = {
  ask: () => Promise.resolve("none"),
  permit: () => Promise.resolve({ allow: true }),
};

const ownership = (over: Partial<Ownership> = {}): Ownership => ({
  children: [
    { id: "code", type: "claude.worker" },
    { id: "tests", type: "claude.worker" },
  ],
  templates: ["code"],
  workersLeft: () => 1,
  delegate: tasks =>
    Promise.resolve({
      reports: tasks.map(task => ({
        child: task.child,
        ok: true,
        output: { status: "pass", summary: "done" },
      })),
      notes: [],
    }),
  spawn: () => Promise.resolve({ reports: [], notes: [] }),
  ...over,
});

const ports = (): SessionPorts => ({ human, ownership: ownership() });

const headless = () =>
  orkTools({ nodeId: "lead", driver: "cli", ports: ports() });

const spec: SessionSpec = {
  nodeId: "lead",
  cwd: process.cwd(),
  model: "haiku",
  effort: "low",
  prompt: "Lead",
  systemAppend: "# Ork",
  settingSources: ["project", "local"],
  tools: { allow: [], deny: [] },
  permissionMode: "default",
  maxTurns: 5,
  reportSchema: { type: "object" },
};

const sdkServer = () => {
  const config = buildSdkOptions(spec, ports(), {}).mcpServers?.["ork"];
  if (config === undefined || !("instance" in config)) {
    throw new Error("no in-process server");
  }
  return config.instance;
};

/** A request to the SDK driver's real in-process server, as the SDK sends it. */
const sdkRpc = async (
  method: string,
  params: Record<string, unknown>,
): Promise<string> => {
  const server = sdkServer();
  const replies: unknown[] = [];
  const transport: Parameters<typeof server.connect>[0] = {
    start: () => Promise.resolve(),
    close: () => Promise.resolve(),
    send: message => {
      replies.push(message);
      return Promise.resolve();
    },
  };
  await server.connect(transport);
  transport.onmessage?.({ jsonrpc: "2.0", id: 1, method, params });
  await expect.poll(() => replies.length).toBe(1);
  return JSON.stringify(replies[0]);
};

const ListedSchema = z.object({
  result: z.object({
    tools: z.array(
      z.object({
        inputSchema: z.object({
          properties: z.object({
            tasks: z.object({
              items: z.object({
                properties: z.record(
                  z.string(),
                  z.object({ enum: z.array(z.string()).optional() }),
                ),
              }),
            }),
          }),
        }),
      }),
    ),
  }),
});

/** The ids one tool's headless `tools/list` entry allows for a task field. */
const listedIds = async (name: string, field: string) => {
  const reply = await handleRpc(
    headless().filter(tool => tool.name === name),
    { jsonrpc: "2.0", id: 1, method: "tools/list" },
  );
  return ListedSchema.parse(reply).result.tools[0]?.inputSchema.properties.tasks
    .items.properties[field]?.enum;
};

const called = async (name: string, tasks: unknown): Promise<string> =>
  JSON.stringify(
    await handleRpc(headless(), {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name, arguments: { tasks } },
    }),
  );

describe("delegate's and spawn_worker's arguments", () => {
  it("list the leader's ids as an enum on the headless driver", async () => {
    expect(await listedIds("delegate", "child")).toEqual(["code", "tests"]);
    expect(await listedIds("spawn_worker", "template")).toEqual(["code"]);
  });

  it("list the leader's ids as an enum on the SDK driver", async () => {
    const reply = await sdkRpc("tools/list", {});
    expect(reply).toContain('"enum":["code","tests"]');
    expect(reply).toContain('"enum":["code"]');
  });

  it("name a stray key, the field it should be and the ids", async () => {
    expect(await called("delegate", [{ node: "code", brief: "b" }])).toContain(
      "tasks[0]: unknown field `node`; the field is `child`, one of: code, tests",
    );
    expect(
      await called("spawn_worker", [{ name: "code", brief: "b" }]),
    ).toContain(
      "tasks[0]: unknown field `name`; the field is `template`, one of: code",
    );
  });

  it("list the valid ids for an id the leader does not own", async () => {
    expect(await called("delegate", [{ child: "x", brief: "b" }])).toContain(
      String.raw`tasks[0].child: Invalid option: expected one of \"code\"|\"tests\"`,
    );
  });

  it("say which field is wrong for any other bad argument", async () => {
    expect(await called("delegate", [{ child: "code", brief: "" }])).toContain(
      "tasks[0].brief: Too small",
    );
  });

  it("reach the leader's children only when valid", async () => {
    expect(await called("delegate", [{ child: "code", brief: "b" }])).toContain(
      String.raw`\"child\":\"code\",\"ok\":true`,
    );
  });

  // The SDK's server validates before Ork's `call`, so its raw issue list is
  // what an SDK leader reads; this pins that it still names all three.
  it("name the stray key, field and ids in the Agent SDK's message", async () => {
    const reply = await sdkRpc("tools/call", {
      name: "delegate",
      arguments: { tasks: [{ node: "code", brief: "b" }] },
    });
    expect(reply).toContain("Input validation error");
    expect(reply).toContain(String.raw`Unrecognized key: \\\"node\\\"`);
    expect(reply).toContain(String.raw`\"child\"`);
    expect(reply).toContain(
      String.raw`expected one of \\\"code\\\"|\\\"tests\\\"`,
    );
  });

  it("are still not offered to a leader with no children", () => {
    const tools = orkTools({
      nodeId: "lead",
      driver: "cli",
      ports: {
        human,
        ownership: ownership({ children: [], templates: [] }),
      },
    });
    expect(tools.map(tool => tool.name)).not.toContain("delegate");
    expect(tools.map(tool => tool.name)).not.toContain("spawn_worker");
  });
});
