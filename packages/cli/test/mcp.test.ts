/**
 * @file Tests for `ork mcp` (RFC-012) through a real MCP client: it lists Ork's
 *   tools as read-only, answers a call, says when a call is refused, and starts
 *   on stdio with nothing but the protocol on stdout.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

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
const connected = async (): Promise<Client> => {
  const { server, close } = orkMcpServer({ home: home() });
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

describe("ork mcp", () => {
  it("lists Ork's tools, each marked read-only", async () => {
    const { tools } = await (await connected()).listTools();
    expect(tools.map(({ name }) => name)).toContain("workflow_format");
    expect(
      tools.every(({ annotations }) => annotations?.readOnlyHint === true),
    ).toBe(true);
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
});
