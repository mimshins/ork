/**
 * @file What `ork mcp` opens (RFC-012): the store under a home, and the tools
 *   on it, as one more client of the store beside the CLI and `ork ui`.
 */

import { openStore, storePath } from "@krapht/ork-core";

import type { ServerContext } from "./context.ts";
import { mcpTools, type McpTool } from "./mcp-tools.ts";

export type { McpAnswer } from "./mcp-answers.ts";
export type { McpTool };

export type OpenMcp = { tools: McpTool[]; close: () => void };

export const openMcp = (options: {
  version: string;
  home?: string;
}): OpenMcp => {
  const store = openStore(storePath(options.home));
  const context: ServerContext = {
    store,
    version: options.version,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    ...(options.home === undefined ? {} : { home: options.home }),
  };
  return {
    tools: mcpTools(context),
    close: () => {
      store.close();
    },
  };
};
