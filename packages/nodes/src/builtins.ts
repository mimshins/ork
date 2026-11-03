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
import { spawnTool } from "./spawn.ts";
import { toolExecutor, type ToolRunner } from "./tools.ts";

/** Every built-in node type that does work; control nodes are the scheduler's. */
export const builtinExecutors = (
  options: ClaudeExecutorOptions & {
    tools?: ToolRunner;
    /** The `ork` a program can run; only the CLI knows it. */
    orkBin?: string;
  },
): NodeExecutors => {
  const claude = claudeExecutor(options);
  const tool = toolExecutor(
    options.tools ?? spawnTool,
    options.orkBin === undefined ? {} : { orkBin: options.orkBin },
  );
  const executors: NodeExecutors = {
    "claude.leader": claude,
    "claude.worker": claude,
    "human.gate": gateExecutor,
    "workflow.call": callExecutor,
  };
  for (const integration of INTEGRATIONS) {
    executors[`${TOOL_PREFIX}${integration.id}`] = tool;
  }
  return executors;
};
