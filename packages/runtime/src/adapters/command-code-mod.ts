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
 *   is allowed only by a plain `Bash` rule.
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
import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
const RULES = ${JSON.stringify(rules)};
// Command Code's own: loading a deferred tool's schema, Ork's report included.
const META = new Set(["search_tools", "tool_search"]);
// Reads a session makes in its worktree without a rule, as Claude Code does.
const READS = new Set(["read_file", "read_multiple_files", "read_directory", "glob", "grep"]);
// A read's paths: every value of a path-like key, and any other string that
// looks like a path out (absolute, from the home folder, or climbing with ..).
const looksOut = text => isAbsolute(text) || text.startsWith("~") || text.split("/").includes("..");
const pathsOf = input => Object.entries(input ?? {})
  .flatMap(([key, value]) => (Array.isArray(value) ? value : [value]).map(each => [key, each]))
  .filter(([key, value]) => typeof value === "string" && (/path|file|dir/i.test(key) || looksOut(value)))
  .map(([, value]) => value);
// Where a path really is: the nearest folder of it that exists, with its links
// followed, and the rest of the path on top.
const real = at => {
  const rest = [];
  for (let here = at; ; here = dirname(here)) {
    try {
      return resolve(realpathSync(here), ...rest.reverse());
    } catch {
      if (dirname(here) === here) return at;
      rest.push(basename(here));
    }
  }
};
const ROOT = real(RULES.cwd);
const inside = input => pathsOf(input).every(each => {
  if (each.startsWith("~")) return false;
  const from = relative(ROOT, real(resolve(RULES.cwd, each)));
  return from === "" || (from !== ".." && !from.startsWith("../") && !isAbsolute(from));
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
// The simple commands of a shell line, split at ; & | && || and line breaks
// outside quotes. null when Ork can't read it: a command or process
// substitution, an unclosed quote, or nothing at all.
const TICK = String.fromCharCode(96);
const BACKSLASH = String.fromCharCode(92);
const shellParts = line => {
  const parts = [];
  let part = "";
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    const next = line[i + 1];
    if (quote === "'") {
      part += ch;
      if (ch === "'") quote = null;
      continue;
    }
    if (ch === BACKSLASH) {
      part += ch + (next ?? "");
      i += 1;
      continue;
    }
    if (ch === TICK || (ch === "$" && next === "(")) return null;
    if (quote === '"') {
      part += ch;
      if (ch === '"') quote = null;
      continue;
    }
    if ((ch === "<" || ch === ">") && next === "(") return null;
    if (ch === "'" || ch === '"') {
      quote = ch;
      part += ch;
      continue;
    }
    // Writing a file is an edit, so output goes only to /dev/null or to
    // another stream (2>&1); any other target makes the line one Ork can't read.
    if (ch === ">") {
      let j = i + 1;
      if (line[j] === ">" || line[j] === "|") j += 1;
      if (line[j] === "&") {
        if (!/[0-9-]/.test(line[j + 1] ?? "")) return null;
        part += line.slice(i, j + 2);
        i = j + 1;
        continue;
      }
      while (line[j] === " " || line[j] === "\\t") j += 1;
      let k = j;
      while (k < line.length && !" \\t;&|<>\\n\\r".includes(line[k])) k += 1;
      if (line.slice(j, k) !== "/dev/null") return null;
      part += line.slice(i, k);
      i = k - 1;
      continue;
    }
    // 2>&1 and &> are redirections, not a command's end.
    const redirect = ch === "&" && (next === ">" || line[i - 1] === ">" || line[i - 1] === "<");
    if (!redirect && (ch === ";" || ch === "&" || ch === "|" || ch === "\\n" || ch === "\\r")) {
      parts.push(part);
      part = "";
      continue;
    }
    part += ch;
  }
  if (quote !== null) return null;
  parts.push(part);
  const commands = parts.map(norm).filter(each => each !== "");
  return commands.length === 0 ? null : commands;
};
// The calls a rule is checked against: a shell line's simple commands, each
// alone; one Ork can't read has no command, so only a plain rule covers it.
const callsOf = (name, input) => {
  if ((TOOLS[name] ?? name) !== "Bash" || typeof input?.command !== "string") return [input];
  const parts = shellParts(input.command);
  return parts === null ? [{}] : parts.map(command => ({ ...input, command }));
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
// A deny covers a shell line when it covers any of its commands; an allow,
// only when every command is covered by one rule or another.
const anyDenied = (name, calls) =>
  calls.some(call => RULES.deny.some(rule => matches(rule, name, call) !== false));
const allCovered = (rules, name, calls) =>
  calls.every(call => rules.some(rule => matches(rule, name, call) === true));
export const decide = (name, input) => {
  const calls = callsOf(name, input);
  if (anyDenied(name, calls)) return "denied for this node";
  if (name.startsWith("mcp__ork__") || META.has(name)) return undefined;
  if (RULES.only !== undefined && !allCovered(RULES.only, name, calls)) {
    return "not one of this node's tools";
  }
  if (READS.has(name) && inside(input)) return undefined;
  if (allCovered(RULES.allow, name, calls)) return undefined;
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
