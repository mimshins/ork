/**
 * @file A small real MCP server over stdio, for tests of `mcp.call`: it starts
 *   with what the node gives it and answers each way a server can.
 */

import { existsSync, writeFileSync } from "node:fs";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const NAMES = [
  "echo",
  "env",
  "structured",
  "fails",
  "slow",
  "image",
  "fails-loudly",
  "fails-once",
  "numbers",
];

const text = (value: string, isError = false) => ({
  content: [{ type: "text", text: value }],
  ...(isError ? { isError } : {}),
});

const server = new Server(
  { name: "echo", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, () => ({
  tools: NAMES.map(name => ({
    name,
    inputSchema: { type: "object" as const },
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async request => {
  const { name, arguments: args } = request.params;
  if (name === "echo") return text(JSON.stringify(args));
  if (name === "env") {
    return text(`token ${process.env["PROBE_TOKEN"] ?? "unset"}`);
  }
  if (name === "structured") {
    return { ...text("see the structure"), structuredContent: { state: "OPEN" } };
  }
  if (name === "fails") return text("the tracker is down", true);
  if (name === "fails-loudly") {
    return text(JSON.stringify({ log: "x".repeat(200_000) }), true);
  }
  if (name === "fails-once") {
    // Each look starts its own server, so what it remembers is in a file.
    const seen = String(args?.["seen"]);
    if (existsSync(seen)) return text('{"state":"OPEN"}');
    writeFileSync(seen, "");
    return text("the tracker is down", true);
  }
  if (name === "numbers") {
    const pin = Number(process.env["PROBE_TOKEN"]);
    return { ...text("see the structure"), structuredContent: { pin, title: "x" } };
  }
  if (name === "image") {
    return { content: [{ type: "image", data: "AA==", mimeType: "image/png" }] };
  }
  await new Promise<void>(resolve => {
    setTimeout(resolve, 60_000);
  });
  return text("too late");
});

await server.connect(new StdioServerTransport());
