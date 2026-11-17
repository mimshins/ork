/**
 * @file Sorts one tool call of a Claude Code transcript into a kind, for the
 *   carried-weight report (carried.ts). The sort is a heuristic: a compound
 *   shell command is named by its first real command, so a mislabel moves
 *   weight between kinds and never changes the total. Only the kind's name
 *   leaves this module, never the command.
 */

import { type Json, text } from "./json.ts";

export const KINDS = [
  "reads through the shell",
  "searches",
  "git diff/show/log",
  "tests and checks",
  "Read",
  "Ork tools",
  "extract",
  "other",
] as const;
export type Kind = (typeof KINDS)[number];

const READS = new Set([
  "cat",
  "sed",
  "head",
  "tail",
  "nl",
  "less",
  "bat",
  "awk",
]);
const SEARCHES = new Set(["rg", "grep", "find", "ls", "fd", "tree"]);
const CHECKS = new Set([
  "pnpm",
  "npm",
  "npx",
  "yarn",
  "vitest",
  "tsc",
  "oxlint",
  "oxfmt",
  "jest",
  "eslint",
  "prettier",
]);
const GIT_READS = new Set(["diff", "show", "log"]);

/** Words that start a command line without being the command. */
const PREFIX = new Set(["cd", "export", "set", "unset", "source", "."]);

/** The words of the first real command in a shell line. */
const firstCommand = (line: string): string[] => {
  for (const part of line.split(/&&|\|\||;|\||\n/u)) {
    const words = part.trim().split(/\s+/u).filter(Boolean);
    while (words[0] !== undefined && /^[A-Za-z_]\w*=/u.test(words[0])) {
      words.shift();
    }
    const [head] = words;
    if (head !== undefined && !PREFIX.has(head)) return words;
  }
  return [];
};

const kindOfShell = (line: string): Kind => {
  const [head = "", ...rest] = firstCommand(line);
  const name = head.split("/").at(-1) ?? "";
  if (READS.has(name)) return "reads through the shell";
  if (SEARCHES.has(name)) return "searches";
  if (CHECKS.has(name) || (name === "node" && rest[0] === "--test")) {
    return "tests and checks";
  }
  if (name === "git") {
    const sub = rest.find(
      (w, i) => !w.startsWith("-") && !["-C", "-c"].includes(rest[i - 1] ?? ""),
    );
    if (GIT_READS.has(sub ?? "")) return "git diff/show/log";
  }
  return "other";
};

/** The kind of a tool call, by its tool name and, for `Bash`, its command. */
export const kindOf = (tool: string, input: Json): Kind => {
  if (tool === "Bash") return kindOfShell(text(input["command"]) ?? "");
  if (tool === "Read") return "Read";
  if (tool === "Grep" || tool === "Glob") return "searches";
  if (tool === "mcp__ork__extract") return "extract";
  return tool.startsWith("mcp__ork__") ? "Ork tools" : "other";
};
