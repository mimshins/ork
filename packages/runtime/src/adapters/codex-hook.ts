/**
 * @file The Codex hook that holds a session to its node's tool rules (RFC-024,
 *   deny by default). Codex runs a `PreToolUse` command hook given inline by
 *   `-c hooks.PreToolUse=[…]` (with `--dangerously-bypass-hook-trust`) before
 *   each shell command (`Bash`), patch (`apply_patch`) and MCP call; the hook
 *   reads `{tool_name, tool_input}` on stdin and refuses a call by printing a
 *   `deny` decision with its reason. Ork writes the hook for the session in a
 *   private folder outside the checkout (0700, files 0600, `secret-file.ts`)
 *   with the shared matcher (`tools/tool-rules-source.ts`) and the node's
 *   rules, in Claude Code's words; Ork's own tools (`mcp__ork__*`) always go
 *   through, and a tool name Ork does not know is refused. Codex has no read
 *   tool to gate, so no read is let through without a rule. Every call, allowed
 *   or refused, adds a line to a calls file beside it, so the leg's end can
 *   tell a hook that never ran. Anything going wrong in the hook refuses the
 *   call.
 */

import { readFileSync } from "node:fs";

import type { SessionSpec } from "@krapht/ork-core";

import { makeSecretFolder } from "../secret-file.ts";
import { toolRuleSet, toolRulesSource } from "../tools/tool-rules-source.ts";
import { CODEX_TOOLS } from "./codex-events.ts";

/**
 * A `-c` value in TOML: a string as a basic string (JSON's string escaping is
 * valid TOML), an array, an inline table, a number or a boolean.
 */
export const tomlValue = (value: unknown): string => {
  if (Array.isArray(value))
    return `[${value.map(each => tomlValue(each)).join(", ")}]`;
  if (value !== null && typeof value === "object") {
    const pairs = Object.entries(value).map(
      ([key, each]) =>
        `${/^[\w-]+$/u.test(key) ? key : JSON.stringify(key)} = ${tomlValue(each)}`,
    );
    return `{${pairs.join(", ")}}`;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(String(value));
};

/**
 * A word for a POSIX shell, taken as written: single quotes, each `'` in it
 * closed, escaped and reopened, so `$`, backticks and `\` stay literal.
 */
export const shellQuote = (word: string): string =>
  "'" + word.replaceAll("'", String.raw`'\''`) + "'";

/**
 * The files a patch names (`*** Add File:`, `Update File:`, `Delete File:`,
 * `Move to:`), for the write limit; `null` for none. Embedded in the hook.
 */
export const patchFiles = (
  _name: string,
  input: Record<string, unknown> | undefined,
): string[] | null => {
  const text = input?.["command"];
  if (typeof text !== "string") return null;
  const files = text.split("\n").flatMap(line => {
    const header =
      /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/u.exec(
        line.trim(),
      );
    return header?.[1] === undefined ? [] : [header[1].trim()];
  });
  return files.length === 0 ? null : files;
};

/** The matcher's module: the node's rules in Codex's tool names. */
const rulesSource = (spec: SessionSpec): string =>
  `// Ork's rules for one Codex session; written by Ork, removed after it.
${toolRulesSource(toolRuleSet(spec), {
  tools: CODEX_TOOLS,
  // Codex has no read tool: a shell read is a Bash call, held by its rules.
  reads: [],
  meta: [],
  // A patch is an edit, and may write a new file.
  covers: {
    read: ["Read", "Glob", "Grep"],
    edit: ["Edit", "Write"],
    write: ["Edit", "Write"],
  },
  editPaths: patchFiles.toString(),
})}export const known = name => name.startsWith("mcp__") || Object.hasOwn(TOOLS, name);
`;

/**
 * The hook's entry. It loads the matcher inside its `try`, so a failure there
 * refuses the call too; a call it allows prints nothing.
 */
const hookSource = (calls: string): string =>
  `// Ork's hook for one Codex session; written by Ork, removed after it.
import { appendFileSync, readFileSync } from "node:fs";
const CALLS = ${JSON.stringify(calls)};
// Codex ends the reason with its own period.
const refuse = reason => {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason.replace(/\\.$/, "") },
  }));
};
try {
  const { decide, known } = await import("./rules.mjs");
  const call = JSON.parse(readFileSync(0, "utf8"));
  const name = String(call.tool_name ?? "");
  const why = known(name) ? decide(name, call.tool_input ?? {}) : "not a tool Ork knows";
  appendFileSync(CALLS, JSON.stringify({ tool: name, refused: why !== undefined }) + "\\n", { mode: 0o600 });
  if (typeof why === "object") refuse(why.read);
  else if (why !== undefined) refuse("Ork: " + name + " is " + why + ". Do not retry it.");
} catch (error) {
  refuse("Ork: the call is refused, its rules could not be checked (" + String(error?.message ?? error) + ").");
}
`;

/** What the hook saw so far: its calls, and how many it refused. */
export type HookCalls = { calls: number; refused: number };

/** A session's hook: its files, its `-c` value, its count, and its removal. */
export type HookFile = {
  file: string;
  calls: string;
  /** The `hooks.PreToolUse` value for `-c hooks.PreToolUse=<value>`. */
  config: string;
  /** The calls the hook saw, read from the calls file. */
  count: () => HookCalls;
  /** The tool names (Codex's) of the calls it refused, in order. */
  refusals: () => string[];
  remove: () => void;
};

/** A calls file's lines; a missing one has none. */
const callLines = (file: string): string[] => {
  try {
    return readFileSync(file, "utf8")
      .split("\n")
      .filter(line => line.trim() !== "");
  } catch {
    return [];
  }
};

/** Reads a calls file; a missing one is no call. */
const countCalls = (file: string): HookCalls => {
  const lines = callLines(file);
  return {
    calls: lines.length,
    // The hook writes each line with JSON.stringify, so the words are exact.
    refused: lines.filter(line => line.includes('"refused":true')).length,
  };
};

/** The tools a calls file's refused calls named. */
const refusedTools = (file: string): string[] =>
  callLines(file)
    .filter(line => line.includes('"refused":true'))
    .map(line => {
      try {
        const call: unknown = JSON.parse(line);
        const tool =
          call !== null && typeof call === "object" && "tool" in call
            ? call.tool
            : undefined;
        return typeof tool === "string" ? tool : "";
      } catch {
        return "";
      }
    });

/**
 * Writes a session's hook in a fresh private folder; a failure removes the
 * folder before it throws. `root` is where the folder goes (tests).
 */
export const writeHook = (spec: SessionSpec, root?: string): HookFile => {
  const folder = makeSecretFolder(root);
  try {
    // Made empty here, so it is 0600 before the hook appends to it.
    const calls = folder.write("calls.jsonl", "");
    folder.write("rules.mjs", rulesSource(spec));
    const file = folder.write("hook.mjs", hookSource(calls));
    const command = `${shellQuote(process.execPath)} ${shellQuote(file)}`;
    return {
      file,
      calls,
      config: tomlValue([
        { matcher: ".*", hooks: [{ type: "command", command }] },
      ]),
      count: () => countCalls(calls),
      refusals: () => refusedTools(calls),
      remove: folder.remove,
    };
  } catch (error) {
    folder.remove();
    throw error;
  }
};
