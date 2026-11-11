/**
 * @file The built-in node types' executors, by type: Claude nodes, the human
 *   gate, and one tool executor per registered integration. Control nodes are
 *   the scheduler's own.
 */

import type { NodeExecutors } from "@krapht/ork-core";
import { INTEGRATIONS, TOOL_PREFIX } from "@krapht/ork-integrations";

import { callExecutor } from "./call.ts";
import { type ClaudeExecutorOptions, claudeExecutor } from "./claude.ts";
import { gateExecutor } from "./gate.ts";
import { mcpCallExecutor } from "./mcp-call.ts";
import { spawnTool } from "./spawn.ts";
import type { ToolRunner } from "./tool-command.ts";
import { toolExecutor } from "./tools.ts";

/** Every built-in node type that does work; control nodes are the scheduler's. */
export const builtinExecutors = (
  options: ClaudeExecutorOptions & {
    tools?: ToolRunner;
    /** The `ork` a program can run; only the CLI knows it. */
    orkBin?: string;
    /** Variables to mask besides those the workflow reads. */
    maskedNames?: readonly string[];
  },
): NodeExecutors => {
  const tool = toolExecutor(options.tools ?? spawnTool, {
    ...(options.orkBin === undefined ? {} : { orkBin: options.orkBin }),
    ...(options.maskedNames === undefined
      ? {}
      : { maskedNames: options.maskedNames }),
  });
  const claude = claudeExecutor({ ...options, steps: tool });
  const executors: NodeExecutors = {
    "claude.leader": claude,
    "claude.worker": claude,
    "human.gate": gateExecutor,
    "workflow.call": callExecutor,
    "mcp.call": mcpCallExecutor(
      options.maskedNames === undefined
        ? {}
        : { maskedNames: options.maskedNames },
    ),
  };
  for (const integration of INTEGRATIONS) {
    executors[`${TOOL_PREFIX}${integration.id}`] = tool;
  }
  return executors;
};
