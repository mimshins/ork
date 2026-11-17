/**
 * @file A Claude node's tool rules: its own, its workflow's and project's
 *   (`rules.permissions`), its MCP servers, and what its isolation adds. A
 *   `readonly` node is denied the tools that write, and runs git that only
 *   reads without asking: under `reading: extract` (RFC-025, the default) only
 *   `git status`, since `extract` shows a diff, a commit and the log.
 */

import type { ClaudeNode, Workflow } from "@krapht/ork-schema";

import type { ToolRules } from "../runtime/types.ts";

/** Claude Code tools that change files or run commands. */
export const WRITE_TOOLS = ["Write", "Edit", "NotebookEdit"] as const;

/**
 * Commands a readonly node runs without asking: git that only reads. Any other
 * command asks, as for any node, so a reviewer can run the tests with leave.
 * Under `reading: extract` (the default) only `git status`: `extract` shows a
 * diff, a commit and the log (RFC-025).
 */
export const readOnlyCommands = (reading: "extract" | "open"): string[] =>
  (reading === "open" ? ["diff", "log", "show", "status"] : ["status"]).flatMap(
    git => [
      `Bash(git ${git})`,
      `Bash(git ${git} *)`,
      `Bash(git -C * ${git} *)`,
    ],
  );

/** The node's own tool rules, the project's and workflow's, and isolation's. */
export const toolRules = (
  node: ClaudeNode,
  readonly: boolean,
  rules: Workflow["rules"],
  mcp: readonly string[],
): ToolRules => ({
  allow: [
    ...new Set([
      ...(rules?.permissions?.allow ?? []),
      ...(node.tools?.allow ?? []),
      // A headless node can't answer per call; the node's author chose the server.
      // Claude Code writes other characters in a server's name as `_` in tool names.
      ...mcp.map(server => `mcp__${server.replaceAll(/[^\w-]/gu, "_")}`),
      ...(readonly ? readOnlyCommands(rules?.reading ?? "extract") : []),
    ]),
  ],
  deny: [
    ...new Set([
      ...(rules?.permissions?.deny ?? []),
      ...(node.tools?.deny ?? []),
      ...(readonly ? WRITE_TOOLS : []),
    ]),
  ],
  ...(node.tools?.only === undefined ? {} : { only: node.tools.only }),
});
