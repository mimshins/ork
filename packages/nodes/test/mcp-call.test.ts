/**
 * @file Tests for `mcp.call` (RFC-006) against real servers: one over stdio, a
 *   fixture, and one over HTTP, in this process. Ork stores nothing: what a
 *   server needs comes from `.mcp.json` and the user's environment, and is
 *   masked.
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  compileWorkflow,
  type ExecuteContext,
  inRepoPlace,
  type RunEvent,
  type RuntimeEvent,
  startRun,
} from "@krapht/ork-core";
import type { Node, Workflow } from "@krapht/ork-schema";
import { afterEach, describe, expect, it } from "vitest";

import { mcpCallExecutor } from "../src/mcp-call.ts";
import { mcpProblems, readMcpServer } from "../src/mcp-servers.ts";
import { maskedNamesOfRun } from "../src/tool-env.ts";

const FIXTURE = path.join(import.meta.dirname, "fixtures/echo-mcp-server.ts");
const SECRET = "a-secret-value-42";
const PATH_ONLY = { PATH: process.env["PATH"] };

const projectWith = (servers: unknown): string => {
  const root = mkdtempSync(path.join(tmpdir(), "ork-mcp-"));
  writeFileSync(
    path.join(root, ".mcp.json"),
    JSON.stringify({ mcpServers: servers }),
  );
  return root;
};

const STDIO = {
  echo: {
    command: process.execPath,
    args: [FIXTURE],
    env: { PROBE_TOKEN: "${PROBE_TOKEN:-none}" },
  },
};

const contextFor = (
  node: Node,
  root: string,
  over: Partial<ExecuteContext> = {},
): ExecuteContext & { events: RuntimeEvent[] } => {
  const events: RuntimeEvent[] = [];
  const workflow: Workflow = {
    schemaVersion: 1,
    name: "t",
    nodes: { m: node },
  };
  return {
    runId: "r1",
    id: "m",
    node,
    workflow,
    inputs: { issue: "ENG-1", count: 3 },
    outputs: { a: { json: { state: "OPEN" } } },
    input: undefined,
    round: 1,
    cwd: root,
    runDir: path.join(root, "runs"),
    workflowDir: root,
    projectRoot: root,
    budgetLeftUsd: undefined,
    human: {
      ask: () => Promise.resolve(""),
      permit: () => Promise.resolve({ allow: true }),
    },
    emit: event => {
      events.push(event);
    },
    signal: new AbortController().signal,
    events,
    ...over,
  };
};

const call = async (
  tool: string,
  more: Partial<Extract<Node, { type: "mcp.call" }>> = {},
  environ: Record<string, string | undefined> = PATH_ONLY,
  root = projectWith(STDIO),
) => {
  const node: Node = { type: "mcp.call", server: "echo", tool, ...more };
  const given = contextFor(node, root);
  const result = await mcpCallExecutor({ environ })(given);
  return { result, given };
};

describe("mcp.call over stdio", () => {
  it("calls the tool with its arguments rendered", async () => {
    const { result } = await call("echo", {
      arguments: {
        id: "issue {{inputs.issue}}",
        count: "{{inputs.count}}",
        nested: { state: "{{nodes.a.output.json.state}}", kept: 2 },
      },
    });
    expect(result.ok).toBe(true);
    expect(result.output["json"]).toEqual({
      id: "issue ENG-1",
      count: 3,
      nested: { state: "OPEN", kept: 2 },
    });
  });

  it("fails a call whose result isn't what it declared", async () => {
    const fits = await call("structured", {
      output: { schema: { state: ["OPEN"] } },
    });
    expect(fits.result.ok).toBe(true);
    const { result } = await call("structured", {
      output: { schema: { state: ["CLOSED"] } },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("state is `OPEN`, expected `CLOSED`");
    // What it didn't declare isn't its output, so no condition can read it.
    expect(result.output["json"]).toBeUndefined();
  });

  it("takes a structured result as output.json", async () => {
    const { result } = await call("structured");
    expect(result.output).toEqual({
      text: "see the structure",
      json: { state: "OPEN" },
    });
  });

  it("gives text with no JSON when that's all there is", async () => {
    const { result } = await call("fails", {}, { PATH: process.env["PATH"] });
    expect(result.ok).toBe(false);
    expect(result.end).toEqual({
      kind: "command_failed",
      message: "echo.fails exited with an error",
      detail: "the tracker is down",
    });
    expect(result.output["json"]).toBeUndefined();
  });

  it("names content that isn't text", async () => {
    const { result } = await call("image");
    expect(result.output["text"]).toBe("[image content]");
  });

  it("passes a secret through, masked in all it records", async () => {
    const { result, given } = await call(
      "env",
      {
        env: { PROBE_TOKEN: "{{env.USERS_TOKEN}}" },
        arguments: { also: "x" },
      },
      { PATH: process.env["PATH"], USERS_TOKEN: SECRET },
    );
    expect(result.output["text"]).toBe("token [masked]");
    expect(JSON.stringify([result, given.events])).not.toContain(SECRET);
  });

  it("masks a value .mcp.json reads from the environment", async () => {
    const { result, given } = await call(
      "env",
      {},
      {
        PATH: process.env["PATH"],
        PROBE_TOKEN: SECRET,
      },
    );
    expect(result.output["text"]).toBe("token [masked]");
    expect(JSON.stringify([result, given.events])).not.toContain(SECRET);
  });

  it("records the call, without what the server was started with", async () => {
    const { given } = await call("echo", { arguments: { id: "a" } });
    expect(given.events).toMatchObject([
      {
        type: "tool.called",
        name: "echo.echo",
        input: { arguments: { id: "a" } },
      },
      { type: "tool.result", isError: false },
    ]);
  });

  it("stops when the node is stopped", async () => {
    const stopping = new AbortController();
    const node: Node = { type: "mcp.call", server: "echo", tool: "slow" };
    const given = contextFor(node, projectWith(STDIO), {
      signal: stopping.signal,
    });
    const running = mcpCallExecutor({ environ: { PATH: process.env["PATH"] } })(
      given,
    );
    setTimeout(() => {
      stopping.abort();
    }, 300);
    expect((await running).ok).toBe(false);
  }, 20_000);

  it("keeps a failure's reason and output small", async () => {
    const { result } = await call("fails-loudly");
    expect(result.ok).toBe(false);
    expect(String(result.error).length).toBeLessThan(2000);
    expect(result.output["json"]).toBeUndefined();
  });

  it("masks a number in a structured result", async () => {
    const { result } = await call(
      "numbers",
      {},
      { ...PATH_ONLY, PROBE_TOKEN: "12345678" },
    );
    expect(result.output["json"]).toEqual({ pin: "[masked]", title: "x" });
  });

  it("keeps JSON whose text holds a masked number", async () => {
    const { result } = await call(
      "echo",
      { arguments: { pin: 12345678, title: "x" } },
      { ...PATH_ONLY, PROBE_TOKEN: "12345678" },
    );
    expect(result.output["json"]).toEqual({ pin: "[masked]", title: "x" });
  });

  it("does not mask what plainEnv says is not secret", async () => {
    const { result } = await call(
      "env",
      { plainEnv: ["PROBE_TOKEN"] },
      { ...PATH_ONLY, PROBE_TOKEN: SECRET },
    );
    expect(result.output["text"]).toBe(`token ${SECRET}`);
  });

  it("fails clearly on a server that won't start", async () => {
    const { result } = await call(
      "echo",
      {},
      { PATH: process.env["PATH"] },
      projectWith({ echo: { command: "no-such-program-here" } }),
    );
    expect(result.ok).toBe(false);
    expect(result.end?.kind).toBe("tool_missing");
    expect(result.end?.detail).toContain("no-such-program-here");
  });
});

/** A real run of one watching call, with the floor on `every` out of the way. */
const watched = async (
  arguments_: Record<string, unknown>,
  tool: string,
  root = projectWith(STDIO),
) => {
  const events: RunEvent[] = [];
  const { graph, diagnostics } = compileWorkflow({
    schemaVersion: 1,
    name: "t",
    nodes: {
      m: {
        type: "mcp.call",
        server: "echo",
        tool,
        arguments: arguments_,
        watch: {
          every: "5s",
          until: "json.state == 'OPEN'",
          timeout: "1m",
          misses: 2,
        },
      },
    },
  });
  if (graph === null) throw new Error(JSON.stringify(diagnostics));
  const result = await startRun({
    graph,
    inputs: {},
    cwd: root,
    runDir: path.join(root, "runs"),
    projectRoot: root,
    executors: { "mcp.call": mcpCallExecutor({ environ: PATH_ONLY }) },
    human: {
      ask: () => Promise.resolve(""),
      permit: () => Promise.resolve({ allow: true }),
    },
    onEvent: event => {
      events.push(event);
    },
    watchEveryMs: 1,
  }).done;
  const ended = events.filter(event => event.type === "watch.ended");
  return { result, ended };
};

const bodyOf = async (request: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(String(chunk)));
  return Buffer.concat(chunks).toString();
};

const parsedRequest = (body: string): { id?: number; method?: string } =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the SDK's own client wrote it
  JSON.parse(body) as { id?: number; method?: string };

const answer = async (
  request: IncomingMessage,
  response: ServerResponse,
  status: number,
): Promise<void> => {
  const body = await bodyOf(request);
  if (status !== 200) {
    response.writeHead(status).end();
    return;
  }
  const { id, method } = parsedRequest(body);
  if (id === undefined) {
    response.writeHead(202).end();
    return;
  }
  const result =
    method === "initialize"
      ? {
          protocolVersion: "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "http", version: "1" },
        }
      : {
          content: [
            {
              type: "text",
              text: `auth ${request.headers.authorization ?? "none"}`,
            },
          ],
        };
  response
    .writeHead(200, { "content-type": "application/json" })
    .end(JSON.stringify({ jsonrpc: "2.0", id, result }));
};

/** Just enough of an MCP server over HTTP: it says who asked. */
const httpServer = (status = 200) => {
  const server = createServer((request, response) => {
    if (request.method !== "POST") {
      response.writeHead(405).end();
      return;
    }
    void answer(request, response, status);
  });
  return server;
};

describe("a watching mcp.call", () => {
  it("can try again after the server says it failed", async () => {
    const { result } = await call("fails");
    expect(result.ok).toBe(false);
    expect(result.end?.kind).toBe("command_failed");
  });

  it("can try again after a server that won't start", async () => {
    const { result } = await call(
      "echo",
      {},
      PATH_ONLY,
      projectWith({ echo: { command: "no-such-program-here" } }),
    );
    expect(result.ok).toBe(false);
    expect(result.end?.kind).toBe("tool_missing");
    expect(result.transient).toBeUndefined();
  });

  it("can't mend an answer it didn't declare", async () => {
    const { result } = await call("structured", {
      output: { schema: { state: ["CLOSED"] } },
    });
    expect(result.ok).toBe(false);
    expect(result.transient).toBeUndefined();
  });

  it("looks again after a failed look, and goes on from a good one", async () => {
    const seen = path.join(
      mkdtempSync(path.join(tmpdir(), "ork-mcp-seen-")),
      "seen",
    );
    const { result, ended } = await watched({ seen }, "fails-once");
    expect(result.status).toBe("succeeded");
    expect(ended).toEqual([
      { type: "watch.ended", id: "m", looks: 2, outcome: "met" },
    ]);
  }, 20_000);

  it("counts failed looks toward misses, rather than failing at the first", async () => {
    const { result, ended } = await watched({}, "fails");
    expect(result.status).toBe("failed");
    expect(result.nodes[0]?.error).toContain("2 looks in a row failed");
    expect(result.nodes[0]?.end?.detail).toContain("the tracker is down");
    expect(ended).toEqual([
      { type: "watch.ended", id: "m", looks: 2, outcome: "failed" },
    ]);
  }, 20_000);

  it("counts a server that won't start the same way", async () => {
    const { result, ended } = await watched(
      {},
      "echo",
      projectWith({ echo: { command: "no-such-program-here" } }),
    );
    expect(result.nodes[0]?.error).toContain("2 looks in a row failed");
    expect(ended).toEqual([
      { type: "watch.ended", id: "m", looks: 2, outcome: "failed" },
    ]);
  }, 20_000);
});

describe("mcp.call over HTTP", () => {
  const servers: Server[] = [];
  afterEach(() => {
    for (const server of servers.splice(0)) server.close();
  });

  const listening = async (status?: number): Promise<string> => {
    const server = httpServer(status);
    servers.push(server);
    await new Promise<void>(resolve => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    const port = typeof address === "object" ? address?.port : undefined;
    return `http://127.0.0.1:${String(port)}/mcp`;
  };

  it("sends the headers .mcp.json gives, masked in what it records", async () => {
    const url = await listening();
    const { result } = await call(
      "whoami",
      {},
      { HTTP_TOKEN: SECRET },
      projectWith({
        echo: {
          type: "http",
          url,
          headers: { Authorization: "Bearer ${HTTP_TOKEN}" },
        },
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.output["text"]).toBe("auth Bearer [masked]");
  });

  it("says a server wants a sign-in, rather than asking for one", async () => {
    const url = await listening(401);
    const { result } = await call(
      "whoami",
      {},
      {},
      projectWith({ echo: { type: "http", url } }),
    );
    expect(result.ok).toBe(false);
    expect(result.end?.kind).toBe("auth");
    expect(result.end?.detail).toContain("asks for a sign-in");
  });
});

describe("reading .mcp.json", () => {
  it.each([
    ["no such server", { other: { command: "x" } }, "which has other"],
    ["OAuth", { echo: { type: "http", url: "u", oauth: {} } }, "OAuth"],
    ["SSE", { echo: { type: "sse", url: "u" } }, "stdio and http"],
  ])("refuses %s", (_name, servers, reason) => {
    const read = readMcpServer(projectWith(servers), "echo");
    expect(read).toMatchObject({ ok: false });
    expect(JSON.stringify(read)).toContain(reason);
  });

  it("says so with no file", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ork-mcp-"));
    expect(JSON.stringify(readMcpServer(root, "echo"))).toContain(
      "no MCP server `echo`",
    );
  });

  it("says so for a file that isn't JSON", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ork-mcp-"));
    writeFileSync(path.join(root, ".mcp.json"), "{ nope");
    expect(JSON.stringify(readMcpServer(root, "echo"))).toContain(
      "can't be read",
    );
  });

  it("does not quote a file it can't parse, which may hold a secret", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ork-mcp-"));
    writeFileSync(
      path.join(root, ".mcp.json"),
      '{"Authorization":Bearer sk-1}',
    );
    const read = JSON.stringify(readMcpServer(root, "echo"));
    expect(read).toContain("not valid JSON");
    expect(read).not.toContain("sk-1");
  });

  it.each([
    ["args", { command: "x", args: ["serve", 8080] }],
    ["env", { command: "x", env: { PORT: 8080 } }],
    ["headers", { type: "http", url: "http://x", headers: { Retry: 3 } }],
  ])("refuses a value in %s that would be dropped", (field, server) => {
    const read = JSON.stringify(
      readMcpServer(projectWith({ echo: server }), "echo"),
    );
    expect(read).toContain(`a value in ${field}`);
  });

  it("finds a server's program that is not installed", () => {
    const workflow: Workflow = {
      schemaVersion: 1,
      name: "t",
      nodes: { a: { type: "mcp.call", server: "s", tool: "x" } },
    };
    const root = projectWith({ s: { command: "not-a-program" } });
    expect(mcpProblems(workflow, root, {}, new Set(), () => false)).toEqual([
      "`a`: MCP server `s` runs `not-a-program`, which is not installed",
    ]);
  });

  it("has a run mask what its servers read, across all its nodes", () => {
    const workflow: Workflow = {
      schemaVersion: 1,
      name: "t",
      nodes: {
        a: { type: "mcp.call", server: "s", tool: "x", plainEnv: ["REGION"] },
      },
    };
    const root = projectWith({
      s: {
        type: "http",
        url: "http://x/${REGION}",
        headers: { Authorization: "Bearer ${LINEAR_TOKEN}" },
      },
    });
    expect(maskedNamesOfRun(workflow, inRepoPlace(root), [], {})).toEqual([
      "LINEAR_TOKEN",
    ]);
  });

  it("finds what would stop a run before it starts", () => {
    const workflow: Workflow = {
      schemaVersion: 1,
      name: "t",
      nodes: {
        a: { type: "mcp.call", server: "gone", tool: "x" },
        b: { type: "mcp.call", server: "needs", tool: "x" },
        c: {
          type: "mcp.call",
          server: "needs",
          tool: "x",
          env: { TOK: "{{env.OTHER}}" },
        },
        d: { type: "mcp.call", server: "ok", tool: "x" },
      },
    };
    const root = projectWith({
      needs: { command: "x", env: { T: "${TOK}" } },
      ok: { command: "x", env: { T: "${TOK:-fine}" } },
    });
    expect(mcpProblems(workflow, root, {})).toEqual([
      "a: no MCP server `gone` in .mcp.json, which has needs, ok",
      "b: .mcp.json reads TOK, which is not set",
    ]);
    expect(mcpProblems(workflow, root, {}, new Set(["a", "b"]))).toEqual([]);
  });
});
