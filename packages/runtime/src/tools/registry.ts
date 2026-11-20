/**
 * @file The registry of Ork's MCP tools. Both drivers serve what it binds for a
 *   session; a new tool is one file here and one line in `ORK_TOOLS`.
 */

// oxlint-disable import/max-dependencies -- a registry imports one module per tool
import { z } from "zod";

import type { HostTool } from "../adapter.ts";
import { askUserTool } from "./ask-user.ts";
import { claimTool, releaseTool } from "./claims.ts";
import { delegateTool, spawnWorkerTool } from "./delegate.ts";
import { extractTool } from "./extract.ts";
import { feedbackTool } from "./feedback.ts";
import { followUpTool } from "./follow-up.ts";
import { readInputTool } from "./input.ts";
import {
  answerTool,
  readInboxTool,
  sendMessageTool,
  waitForMessagesTool,
} from "./messages.ts";
import { permissionTool } from "./permission.ts";
import { reportTool } from "./report.ts";
import {
  type BoundTool,
  type OrkTool,
  hostToolName,
  type ToolContext,
  toolId,
} from "./tool.ts";

export const ORK_TOOLS: readonly OrkTool[] = [
  askUserTool,
  permissionTool,
  delegateTool,
  spawnWorkerTool,
  sendMessageTool,
  readInboxTool,
  waitForMessagesTool,
  answerTool,
  readInputTool,
  extractTool,
  claimTool,
  releaseTool,
  feedbackTool,
  followUpTool,
  reportTool,
];

/** The tools one session gets. */
export const orkTools = (context: ToolContext): BoundTool[] =>
  ORK_TOOLS.flatMap(tool => tool.bind(context) ?? []);

/** Their Claude Code names, for the session's allowed tools. */
export const preapprovedTools = (tools: readonly BoundTool[]): string[] =>
  tools.filter(t => t.preapproved).map(t => toolId(t.name));

/**
 * The same tools as a protocol driver's host tools (`CliAdapter.hostTools`),
 * with the JSON Schema the MCP server gives as `inputSchema`.
 */
export const hostTools = (tools: readonly BoundTool[]): HostTool[] =>
  tools.map(t => ({
    name: hostToolName(t.name),
    description: t.description,
    parameters: z.toJSONSchema(t.schema),
    call: t.call,
  }));
