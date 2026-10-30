/**
 * @file Tests for the runtime: the normalizer, Ork's MCP server, and both
 *   drivers (the CLI driver against a stand-in `claude`).
 */

import { fileURLToPath } from "node:url";

import type {
  HumanChannel,
  Ownership,
  RuntimeEvent,
  SessionSpec,
} from "@krapht/ork-core";
import { describe, expect, it } from "vitest";

import {
  buildCliArgs,
  buildSdkOptions,
  createCliRuntime,
  createSdkRuntime,
  handleRpc,
  normalize,
  NO_SDK_CREDENTIALS,
  orkTools,
  preapprovedTools,
  sdkCredentials,
  startOrkMcpHttp,
} from "../src/index.ts";

const FAKE_CLAUDE = fileURLToPath(
  new URL("fixtures/fake-claude.mjs", import.meta.url),
);

const spec: SessionSpec = {
  nodeId: "approver",
  cwd: process.cwd(),
  model: "haiku",
  effort: "low",
  prompt: "Review the branch",
  systemAppend: "# Ork",
  settingSources: ["project", "local"],
  tools: { allow: [], deny: ["Bash"] },
  permissionMode: "default",
  maxTurns: 5,
  reportSchema: { type: "object" },
};

type Asked = Parameters<HumanChannel["ask"]>[0];

const recordingHuman = () => {
  const asked: Asked[] = [];
  const permits: string[] = [];
  const human: HumanChannel = {
    ask: question => {
      asked.push(question);
      return Promise.resolve(question.recommended ?? "none");
    },
    permit: ({ toolName }) => {
      permits.push(toolName);
      return Promise.resolve(
        toolName === "Bash"
          ? { allow: false, message: "not in this run" }
          : { allow: true },
      );
    },
  };
  return { human, asked, permits };
};

const collect = async (events: AsyncIterable<RuntimeEvent>) => {
  const all: RuntimeEvent[] = [];
  for await (const event of events) all.push(event);
  return all;
};

describe("normalize", () => {
  it("maps stream-json messages to runtime events", () => {
    expect(
      normalize({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "hi" },
            { type: "thinking", thinking: "…" },
            { type: "tool_use", id: "t", name: "Read", input: { path: "a" } },
          ],
        },
      }),
    ).toEqual([
      { type: "assistant.text", text: "hi" },
      { type: "tool.called", id: "t", name: "Read", input: { path: "a" } },
    ]);
    expect(normalize({ type: "stream_event" })).toEqual([]);
    expect(normalize("not json")).toEqual([]);
  });
});

describe("Ork's MCP server", () => {
  it("lists and calls tools over JSON-RPC", async () => {
    const { human, asked } = recordingHuman();
    const tools = orkTools({ nodeId: "n", driver: "cli", ports: { human } });
    const list = await handleRpc(tools, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });
    expect(JSON.stringify(list)).toContain('"name":"ask_user"');
    expect(JSON.stringify(list)).toContain('"name":"permission"');

    const denied = await handleRpc(tools, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "permission",
        arguments: { tool_name: "Bash", input: { command: "rm -rf /" } },
      },
    });
    expect(JSON.stringify(denied)).toContain(
      String.raw`{\"behavior\":\"deny\",\"message\":\"not in this run\"}`,
    );

    const invalid = await handleRpc(tools, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "ask_user", arguments: { question: "x", options: [] } },
    });
    expect(invalid).toMatchObject({ result: { isError: true } });
    expect(asked).toEqual([]);

    expect(
      await handleRpc(tools, { jsonrpc: "2.0", method: "notifications/x" }),
    ).toBeNull();
  });

  it("serves only 127.0.0.1 with its bearer token", async () => {
    const { human } = recordingHuman();
    const endpoint = await startOrkMcpHttp(
      orkTools({ nodeId: "n", driver: "cli", ports: { human } }),
    );
    expect(endpoint.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/u);
    const post = (headers: Record<string, string>) =>
      fetch(endpoint.url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "ping" }),
      });
    expect((await post({})).status).toBe(401);
    expect((await post({ authorization: "Bearer wrong" })).status).toBe(401);
    const ok = await post({ authorization: `Bearer ${endpoint.token}` });
    expect(await ok.json()).toEqual({ jsonrpc: "2.0", id: 7, result: {} });
    await endpoint.close();
  });
});

/** A leader's ports with one child, `fix`, and room for one more worker. */
const leaderPorts = () => {
  const { human } = recordingHuman();
  const delegated: unknown[] = [];
  const ownership: Ownership = {
    children: [{ id: "fix", type: "claude.worker" }],
    templates: ["fix"],
    workersLeft: () => 1,
    delegate: tasks => {
      delegated.push(tasks);
      return Promise.resolve({
        reports: [
          {
            child: "fix",
            ok: true,
            output: {
              status: "pass",
              summary: "fixed",
              usage: { costUsd: 0.5, turns: 3 },
            },
          },
        ],
        notes: [],
      });
    },
    spawn: () => Promise.resolve({ reports: [], notes: [] }),
  };
  return { ports: { human, ownership }, delegated };
};

const names = (tools: { name: string }[]) => tools.map(t => t.name);

describe("Ork's tool registry", () => {
  it("gives delegate and spawn_worker only to a leader with children", () => {
    const { human } = recordingHuman();
    expect(
      names(orkTools({ nodeId: "w", driver: "sdk", ports: { human } })),
    ).toEqual(["ask_user"]);
    const leader = orkTools({
      nodeId: "lead",
      driver: "cli",
      ports: leaderPorts().ports,
    });
    expect(names(leader)).toEqual([
      "ask_user",
      "permission",
      "delegate",
      "spawn_worker",
    ]);
    expect(preapprovedTools(leader)).toEqual([
      "mcp__ork__ask_user",
      "mcp__ork__delegate",
      "mcp__ork__spawn_worker",
    ]);
  });

  it("delegates and returns the reports without usage details", async () => {
    const { ports, delegated } = leaderPorts();
    const tools = orkTools({ nodeId: "lead", driver: "cli", ports });
    const reply = await handleRpc(tools, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "delegate",
        arguments: { tasks: [{ child: "fix", brief: "Fix the bug" }] },
      },
    });
    expect(delegated).toEqual([[{ child: "fix", brief: "Fix the bug" }]]);
    expect(reply).toEqual({
      result: {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              reports: [
                {
                  child: "fix",
                  ok: true,
                  status: "pass",
                  summary: "fixed",
                  costUsd: 0.5,
                },
              ],
            }),
          },
        ],
      },
    });
  });
});

describe("the CLI driver", () => {
  it("builds print-mode arguments with Ork's MCP server and permission tool", () => {
    const args = buildCliArgs(
      spec,
      { url: "http://127.0.0.1:1/mcp", token: "t" },
      ["mcp__ork__ask_user"],
    );
    expect(args.slice(0, 6)).toEqual([
      "-p",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
    ]);
    const value = (flag: string) => args[args.indexOf(flag) + 1];
    expect(value("--setting-sources")).toBe("project,local");
    expect(value("--permission-prompt-tool")).toBe("mcp__ork__permission");
    expect(value("--allowedTools")).toBe("mcp__ork__ask_user");
    expect(value("--disallowedTools")).toBe("Bash");
    expect(value("--model")).toBe("haiku");
    expect(value("--effort")).toBe("low");
    expect(value("--max-turns")).toBe("5");
    expect(value("--mcp-config")).toContain('"Authorization":"Bearer t"');
    // delegate waits for whole child sessions: past the 60 s request default.
    expect(value("--mcp-config")).toContain('"timeout":86400000');
    expect(args).not.toContain("Review the branch");
  });

  it("loads the node's plugin and settings in both drivers", () => {
    const compiled: SessionSpec = {
      ...spec,
      plugins: ["/runs/r1/plugins/approver"],
      settings: { skillOverrides: { review: "off" } },
    };
    const args = buildCliArgs(compiled, { url: "u", token: "t" }, []);
    const value = (flag: string) => args[args.indexOf(flag) + 1];
    expect(value("--plugin-dir")).toBe("/runs/r1/plugins/approver");
    expect(value("--settings")).toBe('{"skillOverrides":{"review":"off"}}');
    const { human } = recordingHuman();
    expect(
      buildSdkOptions(compiled, { human }, { ANTHROPIC_API_KEY: "k" }),
    ).toMatchObject({
      plugins: [{ type: "local", path: "/runs/r1/plugins/approver" }],
      settings: { skillOverrides: { review: "off" } },
    });
  });

  it("runs a session end to end against a stand-in claude", async () => {
    const { human, asked } = recordingHuman();
    const session = createCliRuntime({ bin: FAKE_CLAUDE }).start(spec, {
      human,
    });
    const events = await collect(session.events);

    expect(events.map(e => e.type)).toEqual([
      "session.started",
      "assistant.text",
      "tool.called",
      "tool.result",
      "session.finished",
    ]);
    expect(asked).toEqual([
      {
        nodeId: "approver",
        question: "Which approach?",
        options: [{ id: "a" }, { id: "b" }],
        recommended: "a",
      },
    ]);
    expect(events.at(-1)).toEqual({
      type: "session.finished",
      outcome: {
        subtype: "success",
        sessionId: "fake-1",
        text: "The user chose: a",
        report: {
          status: "pass",
          summary: "tools: ask_user,permission",
          artifacts: { notes: "notes.md" },
          fields: { verdict: "approve" },
        },
        usage: {
          costUsd: 0.0123,
          inputTokens: 100,
          outputTokens: 20,
          cacheReadTokens: 80,
          cacheWriteTokens: 5,
          turns: 2,
          durationMs: 1500,
        },
        errors: [],
      },
    });
  });

  it("reports a missing claude binary as a failed session", async () => {
    const { human } = recordingHuman();
    const session = createCliRuntime({ bin: "/nonexistent/claude" }).start(
      spec,
      { human },
    );
    const [finished] = await collect(session.events);
    expect(finished).toMatchObject({
      type: "session.finished",
      outcome: { subtype: "error_driver", report: null },
    });
  });
});

describe("the SDK driver", () => {
  it("never runs without an API key or a cloud provider", async () => {
    expect(sdkCredentials({})).toBeNull();
    expect(sdkCredentials({ ANTHROPIC_API_KEY: "k" })).toBe(
      "ANTHROPIC_API_KEY",
    );
    expect(sdkCredentials({ CLAUDE_CODE_USE_VERTEX: "1" })).toBe(
      "Google Vertex AI",
    );
    const { human } = recordingHuman();
    const [finished] = await collect(
      createSdkRuntime({}).start(spec, { human }).events,
    );
    expect(finished).toMatchObject({
      outcome: { subtype: "error_driver", errors: [NO_SDK_CREDENTIALS] },
    });
  });

  it("maps the spec onto Agent SDK options", async () => {
    const { human, permits } = recordingHuman();
    const options = buildSdkOptions(
      spec,
      { human },
      { ANTHROPIC_API_KEY: "k" },
    );
    expect(options).toMatchObject({
      cwd: spec.cwd,
      model: "haiku",
      effort: "low",
      maxTurns: 5,
      settingSources: ["project", "local"],
      systemPrompt: { type: "preset", preset: "claude_code", append: "# Ork" },
      allowedTools: ["mcp__ork__ask_user"],
      disallowedTools: ["Bash"],
      outputFormat: { type: "json_schema", schema: { type: "object" } },
    });
    expect(options.mcpServers).toHaveProperty("ork");
    const decision = await options.canUseTool?.(
      "Bash",
      { command: "ls" },
      {
        signal: new AbortController().signal,
        toolUseID: "t",
        requestId: "r",
      },
    );
    expect(decision).toEqual({ behavior: "deny", message: "not in this run" });
    expect(permits).toEqual(["Bash"]);
  });
});
