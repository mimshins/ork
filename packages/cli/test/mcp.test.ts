/**
 * @file Tests for `ork mcp` (RFC-012) through a real MCP client: it lists Ork's
 *   tools, read-only but `start_run`, answers a call, says when a call is
 *   refused, explains a node's context, starts nothing inside a run, says when
 *   it's older than its caller needs, and serves on stdio.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { openStore, storePath } from "@krapht/ork-core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";

import { orkMcpServer } from "../src/commands/mcp.ts";

const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  await Promise.all(
    cleanups.splice(0).map(cleanup => Promise.resolve(cleanup())),
  );
});

const home = (): string => mkdtempSync(path.join(tmpdir(), "ork-mcp-home-"));

/** A client talking to `ork mcp`'s server in this process. */
const connected = async (
  options: Parameters<typeof orkMcpServer>[0] = {},
): Promise<Client> => {
  const { server, close } = orkMcpServer({ home: home(), env: {}, ...options });
  const [near, far] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(far), client.connect(near)]);
  cleanups.push(async () => {
    await client.close();
    close();
  });
  return client;
};

const textOf = (result: Awaited<ReturnType<Client["callTool"]>>): string => {
  const content: unknown = result.content;
  const first: unknown = Array.isArray(content) ? content[0] : undefined;
  const text: unknown =
    typeof first === "object" && first !== null && "text" in first
      ? first.text
      : undefined;
  return typeof text === "string" ? text : "";
};

/** A home with project `p` registered, and its workflow `w`. */
const withProject = (): string => {
  const at = home();
  const root = mkdtempSync(path.join(tmpdir(), "ork-mcp-project-"));
  const dir = path.join(root, ".ork");
  mkdirSync(path.join(dir, "workflows"), { recursive: true });
  writeFileSync(
    path.join(dir, "workflows", "w.ork.yaml"),
    "schemaVersion: 1\nname: w\nnodes:\n  lead: { type: claude.worker, prompt: Plan it }\n",
  );
  const store = openStore(storePath(at));
  store.addProject({ id: "p", root, mode: "in-repo", dir });
  store.close();
  return at;
};

const names = async (client: Client): Promise<string[]> =>
  (await client.listTools()).tools.map(({ name }) => name);

describe("ork mcp", () => {
  it("lists Ork's tools, each but `start_run` marked read-only", async () => {
    const { tools } = await (await connected()).listTools();
    expect(tools.map(({ name }) => name)).toContain("explain_context");
    expect(
      tools
        .filter(({ annotations }) => annotations?.readOnlyHint !== true)
        .map(({ name }) => name),
    ).toEqual(["start_run"]);
  });

  it("answers a call", async () => {
    const result = await (
      await connected()
    ).callTool({
      name: "projects",
      arguments: {},
    });
    expect(JSON.parse(textOf(result))).toEqual([]);
  });

  it("says when a call is refused", async () => {
    const result = await (
      await connected()
    ).callTool({
      name: "run",
      arguments: { run: "zzz" },
    });
    expect(result.isError).toBe(true);
  });

  it("serves on stdio from the command line", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.resolve(import.meta.dirname, "../src/bin.ts"), "mcp"],
      env: { ...process.env, HOME: home() },
      stderr: "ignore",
    });
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(transport);
    cleanups.push(() => client.close());
    expect(client.getServerVersion()?.name).toBe("ork");
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);
  });

  it("explains what a node's session loads", async () => {
    const client = await connected({ home: withProject() });
    const result = await client.callTool({
      name: "explain_context",
      arguments: { project: "p", workflow: "w", node: "lead" },
    });
    expect(JSON.parse(textOf(result))).toMatchObject({
      node: "lead",
      type: "claude.worker",
    });
  });

  it("starts nothing inside a run, as a project's plugin can load there", async () => {
    const outside = await connected();
    const inside = await connected({ env: { ORK_RUN: "r1" } });
    expect(await names(outside)).toContain("start_run");
    expect(await names(inside)).not.toContain("start_run");
  });

  it("refuses every call when it's older than its caller needs", async () => {
    const client = await connected({ expects: "999.0.0" });
    const result = await client.callTool({ name: "projects", arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("ork upgrade");
  });
});
