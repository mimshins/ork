/**
 * @file What `ork mcp` opens (RFC-012): the store under a home, and the tools
 *   on it, as one more client of the store beside the CLI and `ork ui`.
 *   Starting a run is offered only where the caller allows it: not inside a
 *   run, whose sessions mustn't start more.
 */

import { openStore, type ProjectRecord, storePath } from "@krapht/ork-core";

import { projectOf, type ServerContext } from "./context.ts";
import { actingTools } from "./mcp-act.ts";
import { answer, type McpAnswer, refused } from "./mcp-answers.ts";
import { type McpTool, tool } from "./mcp-tool.ts";
import { mcpTools } from "./mcp-tools.ts";
import { createSignInCodes } from "./sign-in-codes.ts";
import { createUpdates } from "./updates.ts";
import { workflowFile } from "./write-routes.ts";

export {
  answer as mcpAnswer,
  refused as mcpRefused,
  tool as mcpTool,
  type McpAnswer,
  type McpTool,
};

export type OpenMcp = {
  tools: McpTool[];
  /** A project's workflow file, by name or path, for tools built elsewhere. */
  fileOf: (
    project: string,
    workflow: string,
  ) => { project: ProjectRecord; file: string } | { error: string };
  close: () => void;
};

export const openMcp = (options: {
  version: string;
  home?: string;
  /** The `ork` script a started run runs (default: the running one). */
  script?: string;
  /** Whether `start_run` is offered. */
  start: boolean;
}): OpenMcp => {
  const store = openStore(storePath(options.home));
  const context: ServerContext = {
    store,
    version: options.version,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    ...(options.home === undefined ? {} : { home: options.home }),
    ...(options.script === undefined ? {} : { script: options.script }),
    // No check and no upgrade: those are `ork ui`'s.
    updates: createUpdates({ version: options.version }),
    // `ork mcp` serves no sign-in; the store only fills the context.
    codes: createSignInCodes(),
  };
  return {
    tools: [
      ...mcpTools(context),
      ...actingTools(context, { start: options.start }),
    ],
    fileOf: (key, workflow) => {
      const project = projectOf(context, key);
      if (project === undefined) {
        return { error: `No registered project \`${key}\`.` };
      }
      const file = workflowFile(project, workflow);
      return file === null
        ? {
            error: `No workflow \`${workflow}\` in \`${project.id}\`'s workflows or inside its root.`,
          }
        : { project, file };
    },
    close: () => {
      store.close();
    },
  };
};
