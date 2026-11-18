/**
 * @file The Command Code mod that holds a session to its node's tool rules
 *   (RFC-014, deny by default). Command Code takes permission rules only from
 *   settings files (the user's, and two in the checkout), so Ork runs it with
 *   `--permission-mode yolo` and loads, with `--mod`, a mod written for the
 *   session outside the checkout: its `beforeToolCall` hook blocks every call
 *   the node did not allow. Ork's own tools (`mcp__ork__*`) always go through.
 *   Command Code's tool loader passes, and reads inside the worktree need no
 *   rule, as with Claude Code; one reaching outside it (by its real path, links
 *   followed) does. The rules are the node's, in Claude Code's words
 *   (`Bash(git:*)`, `Read`, `mcp__github`); a specifier Ork does not read never
 *   allows a call and always denies one. A shell line is checked command by
 *   command: each must be allowed, and one with a substitution Ork can't read
 *   is allowed only by a plain `Bash` rule. A yolo run (`ork run --yolo`)
 *   allows every call the node's `deny` and `only` don't refuse. The matcher is
 *   shared with Codex's hook (`tools/tool-rules-source.ts`).
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { SessionSpec } from "@krapht/ork-core";

import {
  type ToolRuleSet,
  toolRuleSet,
  toolRulesSource,
} from "../tools/tool-rules-source.ts";
import { COMMAND_CODE_TOOLS } from "./command-code-events.ts";

/**
 * The mod's source. It is plain JavaScript that Command Code loads (a default
 * export taking the mod API), so it carries its own matcher.
 */
export const modSource = (
  rules: ToolRuleSet,
): string => `// Ork's rules for one session; written by Ork, removed after it.
${toolRulesSource(rules, {
  tools: COMMAND_CODE_TOOLS,
  reads: ["read_file", "read_multiple_files", "read_directory", "glob", "grep"],
  // Command Code's own: loading a deferred tool's schema, Ork's report included.
  meta: ["search_tools", "tool_search"],
  // A rule's word, as Command Code reads it, covers these of Ork's tool names.
  covers: { read: ["Read", "Glob", "Grep"], edit: ["Edit", "Write"] },
})}export default cc => {
  cc.hooks({
    beforeToolCall: async call => {
      const why = decide(call.toolName, call.input);
      if (why === undefined) return undefined;
      if (typeof why === "object") return { block: true, additionalContext: why.read };
      return { block: true, additionalContext: "Ork: " + call.toolName + " is " + why + ". Do not retry it." };
    },
  });
};
`;

/** The mod file for a session, and how to remove it. */
export type ModFile = { file: string; remove: () => void };

/**
 * Writes a session's mod outside the checkout (a fresh folder under the
 * system's temp folder, 0700, the file 0600); it holds no secret.
 */
export const writeMod = (spec: SessionSpec): ModFile => {
  const dir = mkdtempSync(path.join(tmpdir(), "ork-cmd-mod-"));
  const file = path.join(dir, "ork-rules.mjs");
  writeFileSync(file, modSource(toolRuleSet(spec)), { mode: 0o600 });
  return {
    file,
    remove: () => {
      rmSync(dir, { recursive: true, force: true });
    },
  };
};
