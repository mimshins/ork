/**
 * @file The registry of Ork's MCP tools. Both drivers serve what it binds for a
 *   session; a new tool is one file here and one line in `ORK_TOOLS`.
 */

import { askUserTool } from "./ask-user.ts";
import { claimTool, releaseTool } from "./claims.ts";
import { delegateTool, spawnWorkerTool } from "./delegate.ts";
import { answerTool, readInboxTool, sendMessageTool } from "./messages.ts";
import { permissionTool } from "./permission.ts";
import {
  type BoundTool,
  type OrkTool,
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
  answerTool,
  claimTool,
  releaseTool,
];

/** The tools one session gets. */
export const orkTools = (context: ToolContext): BoundTool[] =>
  ORK_TOOLS.flatMap(tool => tool.bind(context) ?? []);

/** Their Claude Code names, for the session's allowed tools. */
export const preapprovedTools = (tools: readonly BoundTool[]): string[] =>
  tools.filter(t => t.preapproved).map(t => toolId(t.name));
