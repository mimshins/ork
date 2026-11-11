/**
 * @file Tests for the runtime: the normalizer, Ork's MCP server, and both
 *   drivers (the CLI driver against a stand-in `claude`), a leader's one-hour
 *   prompt cache on each.
 */

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  type HumanChannel,
  type Ownership,
  reportSchemaFor,
  type RuntimeEvent,
  type SessionSpec,
} from "@krapht/ork-core";
import { isClaudeNode, NodeSchema } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import {
  buildCliArgs,
  createCliRuntime,
  handleRpc,
  normalize,
  orkTools,
  preapprovedTools,
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
    // What was asked, without the hooks for a note and an owner's answer.
    ask: ({ onNote: _onNote, onOwner: _onOwner, ...question }) => {
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
    expect(
      normalize({
        type: "rate_limit_event",
        rate_limit_info: {
          status: "rejected",
          rateLimitType: "five_hour",
          resetsAt: 1_800_000_000,
          unifiedWindows: { five_hour: { utilization: 1 } },
        },
      }),
    ).toEqual([
      {
        type: "plan.limit",
        status: "rejected",
        window: "five_hour",
        resetsAt: "2027-01-15T08:00:00.000Z",
      },
    ]);
    expect(
      normalize({
        type: "rate_limit_event",
        rate_limit_info: { status: "new" },
      }),
    ).toEqual([]);
    expect(normalize({ type: "rate_limit_event" })).toEqual([]);
    expect(
      normalize({
        type: "rate_limit_event",
        rate_limit_info: {
          status: "rejected",
          overageStatus: "allowed",
          rateLimitType: "five_hour",
          resetsAt: 1_800_000_000_000,
        },
      }),
    ).toEqual([
      { type: "plan.limit", status: "allowed_warning", window: "five_hour" },
    ]);
    expect(normalize({ type: "stream_event" })).toEqual([]);
    expect(normalize("not json")).toEqual([]);
  });
});

describe("Ork's MCP server", () => {
  it("lists and calls tools over JSON-RPC", async () => {
    const { human, asked } = recordingHuman();
    const tools = orkTools({
      nodeId: "n",
      driver: "claude-code",
      ports: { human },
    });
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
      orkTools({ nodeId: "n", driver: "claude-code", ports: { human } }),
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
    children: [{ id: "fix", type: "agent.worker" }],
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
      names(orkTools({ nodeId: "w", driver: "claude-code", ports: { human } })),
    ).toEqual(["ask_user", "permission"]);
    const leader = orkTools({
      nodeId: "lead",
      driver: "claude-code",
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
    const tools = orkTools({ nodeId: "lead", driver: "claude-code", ports });
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

/** The report a planner declaring a list must end with. */
const listReportSchema = (): Record<string, unknown> => {
  const node = NodeSchema.parse({
    type: "agent.worker",
    output: { schema: { tasks: { list: { title: "string" } } } },
  });
  if (!isClaudeNode(node)) throw new Error("not a Claude node");
  return reportSchemaFor(node);
};

describe("a declared list in the report schema", () => {
  const reportSchema = listReportSchema();
  const withList = { ...spec, reportSchema };

  it("reaches the CLI driver", () => {
    const args = buildCliArgs(
      withList,
      { url: "http://127.0.0.1:1/mcp", token: "t" },
      [],
    );
    expect(args).toContain(JSON.stringify(reportSchema));
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
    expect(args).not.toContain("--tools");
    const only = buildCliArgs(
      { ...spec, tools: { allow: [], deny: [], only: ["Read", "Grep"] } },
      { url: "http://127.0.0.1:1/mcp", token: "t" },
      [],
    );
    expect(only[only.indexOf("--tools") + 1]).toBe("Read,Grep");
    const withAgents = buildCliArgs(
      {
        ...spec,
        agents: { t: { description: "Tests.", prompt: "Write tests." } },
      },
      { url: "http://127.0.0.1:1/mcp", token: "t" },
      [],
    );
    expect(withAgents[withAgents.indexOf("--agents") + 1]).toBe(
      '{"t":{"description":"Tests.","prompt":"Write tests."}}',
    );
    // delegate waits for whole child sessions: past the 60 s request default.
    expect(value("--mcp-config")).toContain('"timeout":86400000');
    expect(args).not.toContain("Review the branch");
  });

  it("loads the node's plugin and settings", () => {
    const compiled: SessionSpec = {
      ...spec,
      plugins: ["/runs/r1/plugins/approver"],
      settings: { skillOverrides: { review: "off" } },
    };
    const args = buildCliArgs(compiled, { url: "u", token: "t" }, []);
    const value = (flag: string) => args[args.indexOf(flag) + 1];
    expect(value("--plugin-dir")).toBe("/runs/r1/plugins/approver");
    expect(value("--settings")).toBe('{"skillOverrides":{"review":"off"}}');
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
    expect(events[0]).toEqual({
      type: "session.started",
      sessionId: "fake-1",
      model: "haiku",
      cwd: process.cwd(),
      driver: "claude-code",
    });
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
        end: { kind: "done", message: "finished" },
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

  it("starts a leader's session with the one-hour prompt cache", async () => {
    const { human } = recordingHuman();
    const dir = mkdtempSync(path.join(tmpdir(), "ork-cache-"));
    const cacheOf = async (given: SessionSpec, name: string) => {
      const file = path.join(dir, name);
      const env = {
        ...process.env,
        ENABLE_PROMPT_CACHING_1H: undefined,
        FAKE_CLAUDE_ENV_FILE: file,
      };
      const session = createCliRuntime({ bin: FAKE_CLAUDE, env }).start(given, {
        human,
      });
      await collect(session.events);
      return readFileSync(file, "utf8");
    };
    expect(await cacheOf({ ...spec, promptCache: "1h" }, "leader")).toBe("1");
    expect(await cacheOf(spec, "worker")).toBe("");
  });

  it("has a stand-in claude that asks nothing, spends a set cost and edits a file", async () => {
    const { human, asked } = recordingHuman();
    const cwd = mkdtempSync(path.join(tmpdir(), "ork-fake-"));
    const env = {
      ...process.env,
      FAKE_CLAUDE_NO_ASK: "1",
      FAKE_CLAUDE_COST: "5.5",
      FAKE_CLAUDE_EDIT: "out.txt",
    };
    const session = createCliRuntime({ bin: FAKE_CLAUDE, env }).start(
      { ...spec, cwd },
      { human },
    );
    const events = await collect(session.events);
    expect(asked).toEqual([]);
    expect(events.at(-1)).toMatchObject({
      type: "session.finished",
      outcome: { usage: { costUsd: 5.5 } },
    });
    expect(readFileSync(path.join(cwd, "out.txt"), "utf8")).not.toBe("");
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
