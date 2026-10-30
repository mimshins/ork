/**
 * @file `@krapht/ork-nodes`: the built-in node types the scheduler runs;
 *   control nodes are the scheduler's own.
 */

import type { NodeExecutors } from "@krapht/ork-core";
import { INTEGRATIONS, TOOL_PREFIX } from "@krapht/ork-integrations";

import { type ClaudeExecutorOptions, claudeExecutor } from "./claude.ts";
import { gateExecutor } from "./gate.ts";
import { spawnTool, toolExecutor, type ToolRunner } from "./tools.ts";

export * from "./claude.ts";
export * from "./gate.ts";
export * from "./tools.ts";

/** Every built-in node type that does work; control nodes are the scheduler's. */
export const builtinExecutors = (
  options: ClaudeExecutorOptions & { tools?: ToolRunner },
): NodeExecutors => {
  const claude = claudeExecutor(options);
  const tool = toolExecutor(options.tools ?? spawnTool);
  const executors: NodeExecutors = {
    "claude.leader": claude,
    "claude.worker": claude,
    "human.gate": gateExecutor,
  };
  for (const integration of INTEGRATIONS) {
    executors[`${TOOL_PREFIX}${integration.id}`] = tool;
  }
  return executors;
};
