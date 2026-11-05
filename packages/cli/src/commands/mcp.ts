/**
 * @file `ork mcp`: Ork's tools for Claude Code over stdio (RFC-012), on the
 *   same handlers as `ork ui`'s API and the same checks as `ork validate`. They
 *   read, check a draft, explain a node's context, and start a run; none
 *   answers a decision or acts on a run. Inside a run nothing starts another,
 *   and an `ork` older than its caller expects says so on every call. It opens
 *   no port and holds no token, and stdout carries only the protocol.
 */

import { isNewer } from "@krapht/ork-core";
import { runMarkerIn } from "@krapht/ork-nodes";
import {
  mcpAnswer,
  mcpRefused,
  mcpTool,
  type McpTool,
  type OpenMcp,
  openMcp,
} from "@krapht/ork-server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { defineCommand } from "citty";
import { z } from "zod";

import { ORK_VERSION } from "../__build_info__.ts";
import { explainNode } from "./context.ts";

const INSTRUCTIONS =
  "Ork runs workflows of Claude sessions and programs on this machine. These tools read what Ork has (projects, workflows, the workflow format, runs, their events and cost, the decisions waiting on a person), check a workflow as `ork validate` does, and explain what a node's session loads. None answers a decision: a person does, in `ork ui` or their own terminal.";

const STARTS = " `start_run` starts a run in the background.";

const explainTool = (opened: OpenMcp, home?: string): McpTool =>
  mcpTool(
    "explain_context",
    "What one node's session would load, as `ork context explain` shows it: its agent, instructions, skills and files, layer by layer, with their tokens.",
    {
      project: z.string().min(1),
      workflow: z.string().min(1).describe("A workflow's name, or a path"),
      node: z.string().min(1),
    },
    ({ project, workflow, node }) => {
      const found = opened.fileOf(project, workflow);
      if ("error" in found) return mcpRefused(found.error);
      const result = explainNode(found.file, node, found.project.root, home);
      return result.ok
        ? mcpAnswer(result.explanation)
        : mcpRefused(result.lines.join("\n"));
    },
  );

/** Every call refused, when this `ork` is older than its caller needs. */
const tooOld = (tools: McpTool[], expects: string): McpTool[] =>
  tools.map(each => ({
    ...each,
    call: () =>
      Promise.resolve(
        mcpRefused(
          `This needs Ork ${expects} or newer, and this is ${ORK_VERSION}. Ask the person to upgrade, with \`ork upgrade\`.`,
        ),
      ),
  }));

/** The server with Ork's tools on it, for stdio here and in tests. */
export const orkMcpServer = (
  options: {
    home?: string;
    script?: string;
    env?: NodeJS.ProcessEnv;
    expects?: string;
  } = {},
) => {
  // A session in a run doesn't start runs: a project's plugin can load there.
  const start = runMarkerIn(options.env ?? process.env) === null;
  const opened = openMcp({
    version: ORK_VERSION,
    start,
    ...(options.home === undefined ? {} : { home: options.home }),
    ...(options.script === undefined ? {} : { script: options.script }),
  });
  const all = [...opened.tools, explainTool(opened, options.home)];
  const tools =
    options.expects !== undefined && isNewer(options.expects, ORK_VERSION)
      ? tooOld(all, options.expects)
      : all;
  const server = new McpServer(
    { name: "ork", version: ORK_VERSION },
    { instructions: start ? `${INSTRUCTIONS}${STARTS}` : INSTRUCTIONS },
  );
  for (const each of tools) {
    server.registerTool(
      each.name,
      {
        description: each.description,
        inputSchema: each.shape,
        annotations: { readOnlyHint: each.readOnly, openWorldHint: false },
      },
      async args => {
        const { text, isError } = await each.call(args);
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
  args: {
    expects: {
      type: "string",
      description: "The oldest Ork the caller works with, such as a plugin",
    },
  },
  run: async ({ args }) => {
    const { server, close } = orkMcpServer(
      args.expects === undefined ? {} : { expects: args.expects },
    );
    const transport = new StdioServerTransport();
    // A transport isn't an EventTarget: `onclose` is how it says it closed.
    // oxlint-disable-next-line unicorn/prefer-add-event-listener
    transport.onclose = () => {
      close();
    };
    await server.connect(transport);
  },
});
