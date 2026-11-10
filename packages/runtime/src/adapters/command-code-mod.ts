/**
 * @file The Command Code mod that holds a session to its node's tool rules
 *   (RFC-014, deny by default). Command Code takes permission rules only from
 *   settings files (the user's, and two in the checkout), so Ork runs it with
 *   `--permission-mode yolo` and loads, with `--mod`, a mod written for the
 *   session outside the checkout: its `beforeToolCall` hook blocks every call
 *   the node did not allow. Ork's own tools (`mcp__ork__*`) always go through.
 *   Command Code's tool loader passes, and reads inside the worktree need no
 *   rule, as with Claude Code; one reaching outside it does. The rules are the
 *   node's, in Claude Code's words (`Bash(git:*)`, `Read`, `mcp__github`); a
 *   specifier Ork does not read never allows a call and always denies one.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { SessionSpec } from "@krapht/ork-core";

import { COMMAND_CODE_TOOLS } from "./command-code-events.ts";

/** What the mod enforces: the node's lists, and the worktree reads stay in. */
export type ModRules = {
  cwd: string;
  allow: string[];
  deny: string[];
  only?: string[];
};

/** The rules of a session: an `acceptEdits` node may edit without a rule. */
export const modRules = (spec: SessionSpec): ModRules => ({
  cwd: spec.cwd,
  allow: [
    ...spec.tools.allow,
    ...(spec.permissionMode === "acceptEdits" ? ["Edit"] : []),
  ],
  deny: spec.tools.deny,
  ...(spec.tools.only === undefined ? {} : { only: spec.tools.only }),
});

/**
 * The mod's source. It is plain JavaScript that Command Code loads (a default
 * export taking the mod API), so it carries its own matcher.
 */
export const modSource = (
  rules: ModRules,
): string => `// Ork's rules for one session; written by Ork, removed after it.
import { relative, resolve } from "node:path";
const RULES = ${JSON.stringify(rules)};
// Command Code's own: loading a deferred tool's schema, Ork's report included.
const META = new Set(["search_tools", "tool_search"]);
// Reads a session makes in its worktree without a rule, as Claude Code does.
const READS = new Set(["read_file", "read_multiple_files", "read_directory", "glob", "grep"]);
const pathsOf = input => Object.entries(input ?? {})
  .filter(([key]) => /path|file|dir/i.test(key))
  .flatMap(([, value]) => (Array.isArray(value) ? value : [value]))
  .filter(value => typeof value === "string");
const inside = input => pathsOf(input).every(each => {
  const from = relative(RULES.cwd, resolve(RULES.cwd, each));
  return from === "" || (!from.startsWith("..") && !from.startsWith("/"));
});
const TOOLS = ${JSON.stringify(COMMAND_CODE_TOOLS)};
// A rule's word, as Command Code reads it, covers these of Ork's tool names.
const COVERS = { read: ["Read", "Glob", "Grep"], edit: ["Edit", "Write"] };
const norm = text => text.trim().replace(/\\s+/g, " ");
const split = rule => {
  const at = rule.indexOf("(");
  return at < 0 || !rule.endsWith(")")
    ? { token: rule.trim() }
    : { token: rule.slice(0, at).trim(), spec: rule.slice(at + 1, -1) };
};
const shellMatches = (command, pattern) => {
  let p = norm(pattern);
  const c = norm(command);
  if (p.endsWith(":*")) p = p.slice(0, -2) + " *";
  if (!p.endsWith(" *")) return c === p;
  const head = p.slice(0, -2);
  return c === head || c.startsWith(head + " ");
};
// true: the rule covers the call; false: it does not; null: Ork can't tell.
const matches = (rule, name, input) => {
  const { token, spec } = split(rule);
  if (token.startsWith("mcp__")) {
    const rest = token.slice(5);
    const at = rest.indexOf("__");
    if (at < 0) return name.startsWith("mcp__" + rest + "__");
    const tool = rest.slice(at + 2);
    return tool === "*" ? name.startsWith("mcp__" + rest.slice(0, at) + "__") : name === token;
  }
  const ork = TOOLS[name] ?? name;
  const word = token.toLowerCase();
  const covered = (COVERS[word] ?? [token]).some(each => each.toLowerCase() === ork.toLowerCase());
  if (!covered && name !== token) return false;
  if (spec === undefined || spec === "" || spec === "*") return true;
  if (ork === "Bash" && typeof input?.command === "string") return shellMatches(input.command, spec);
  return null;
};
export const decide = (name, input) => {
  if (RULES.deny.some(rule => matches(rule, name, input) !== false)) return "denied for this node";
  if (name.startsWith("mcp__ork__") || META.has(name)) return undefined;
  if (RULES.only !== undefined && !RULES.only.some(rule => matches(rule, name, input) === true)) {
    return "not one of this node's tools";
  }
  if (READS.has(name) && inside(input)) return undefined;
  if (RULES.allow.some(rule => matches(rule, name, input) === true)) return undefined;
  return "not allowed for this node";
};
export default cc => {
  cc.hooks({
    beforeToolCall: async call => {
      const why = decide(call.toolName, call.input);
      return why === undefined
        ? undefined
        : { block: true, additionalContext: "Ork: " + call.toolName + " is " + why + ". Do not retry it." };
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
  writeFileSync(file, modSource(modRules(spec)), { mode: 0o600 });
  return {
    file,
    remove: () => {
      rmSync(dir, { recursive: true, force: true });
    },
  };
};
