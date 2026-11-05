/**
 * @file `ork mcp`: Ork's tools for Claude Code over stdio (RFC-012), on the
 *   same handlers as `ork ui`'s API. They read projects, workflows, the format,
 *   runs and what they spent; none answers a decision or acts on a run. It
 *   opens no port and holds no token, and stdout carries only the protocol.
 */

import { openMcp } from "@krapht/ork-server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { defineCommand } from "citty";

import { ORK_VERSION } from "../__build_info__.ts";

const INSTRUCTIONS =
  "Ork runs workflows of Claude sessions and programs on this machine. These tools read what Ork has: projects, workflows, the workflow format, runs, their events and cost, and the decisions waiting on a person. None answers a decision: a person does, in `ork ui` or their own terminal.";

/** The server with Ork's tools on it, for stdio here and in tests. */
export const orkMcpServer = (options: { home?: string } = {}) => {
  const opened = openMcp({ version: ORK_VERSION, ...options });
  const server = new McpServer(
    { name: "ork", version: ORK_VERSION },
    { instructions: INSTRUCTIONS },
  );
  for (const tool of opened.tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.shape,
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async args => {
        const { text, isError } = await tool.call(args);
        return {
          content: [{ type: "text" as const, text }],
          ...(isError === true ? { isError } : {}),
        };
      },
    );
  }
  return { server, close: opened.close };
};

export const mcp = defineCommand({
  meta: {
    name: "mcp",
    description: "Serve Ork's tools to Claude Code over stdio (MCP)",
  },
  run: async () => {
    const { server, close } = orkMcpServer();
    const transport = new StdioServerTransport();
    // A transport isn't an EventTarget: `onclose` is how it says it closed.
    // oxlint-disable-next-line unicorn/prefer-add-event-listener
    transport.onclose = () => {
      close();
    };
    await server.connect(transport);
  },
});
