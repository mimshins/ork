/**
 * @file What `filter` checks about a command line a suggestion drafted: that
 *   its program exists here and that a package script it names is in the
 *   project's `package.json`. Nothing is run; the line is only read
 *   (specs/cli/onboard-verbs.md#filter).
 */

import { accessSync, constants, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { insideRoot } from "./survey-files.ts";

/** Shell builtins a drafted line may start with; they are on no `PATH`. */
const BUILTINS = new Set(["cd", "export", "set", "source", ".", ":", "exit"]);

/** A package manager's own commands: they are not scripts. */
const MANAGER_COMMANDS = new Set([
  "install",
  "i",
  "ci",
  "add",
  "remove",
  "rm",
  "uninstall",
  "update",
  "up",
  "upgrade",
  "exec",
  "dlx",
  "x",
  "create",
  "init",
  "link",
  "unlink",
  "publish",
  "pack",
  "audit",
  "outdated",
  "list",
  "ls",
  "why",
  "store",
  "config",
  "cache",
  "rebuild",
  "prune",
  "dedupe",
  "patch",
  "import",
  "fetch",
  "deploy",
  "env",
  "help",
  "version",
  "info",
  "workspace",
  "workspaces",
  "node",
  "bin",
  "root",
  "login",
  "logout",
  "whoami",
  "licenses",
  "run",
  "run-script",
]);

const ENV_WORD = /^[A-Za-z_][A-Za-z0-9_]*=/u;

/** The words of a drafted line, the leading `VAR=value` words dropped. */
export const wordsOf = (line: string): string[] => {
  const words = line.trim().split(/\s+/u);
  const first = words.findIndex(word => !ENV_WORD.test(word));
  return first === -1 ? [] : words.slice(first);
};

const isExecutable = (file: string): boolean => {
  try {
    accessSync(file, constants.X_OK);
    return statSync(file).isFile();
  } catch {
    return false;
  }
};

/** Whether `program` is on `PATH`, or an executable file inside `root`. */
export const programExists = (program: string, root: string): boolean => {
  if (BUILTINS.has(program)) return true;
  if (program.includes("/")) {
    const file = path.isAbsolute(program) ? program : path.join(root, program);
    const inside = insideRoot(root, path.relative(root, file));
    return inside !== null && isExecutable(inside);
  }
  return (process.env["PATH"] ?? "")
    .split(path.delimiter)
    .some(folder => folder !== "" && isExecutable(path.join(folder, program)));
};

/** The script a package-manager line runs, or null when it runs none. */
export const scriptOf = (words: readonly string[]): string | null => {
  const [manager, first, second] = words;
  if (first === undefined || first.startsWith("-")) return null;
  if (manager === "npm") {
    if (first === "test" || first === "t") return "test";
    return first === "run" || first === "run-script" ? (second ?? null) : null;
  }
  if (manager === "bun") return first === "run" ? (second ?? null) : null;
  if (manager !== "pnpm" && manager !== "yarn") return null;
  if (first === "run" || first === "run-script") return second ?? null;
  return MANAGER_COMMANDS.has(first) ? null : first;
};

/** The names in the root's `package.json` `scripts`; none when unreadable. */
export const packageScripts = (root: string): Set<string> => {
  try {
    const file = insideRoot(root, "package.json");
    if (file === null) return new Set();
    const data: unknown = JSON.parse(readFileSync(file, "utf8"));
    const scripts =
      typeof data === "object" && data !== null && "scripts" in data
        ? data.scripts
        : undefined;
    return typeof scripts === "object" && scripts !== null
      ? new Set(Object.keys(scripts))
      : new Set();
  } catch {
    return new Set();
  }
};

/** What is wrong with one drafted line, one reason each. */
export const commandReasons = (
  line: string,
  root: string,
  scripts: ReadonlySet<string>,
): string[] => {
  const words = wordsOf(line);
  const [program] = words;
  if (program === undefined) return [`command \`${line}\` names no program`];
  if (!programExists(program, root)) {
    return [`command \`${line}\`: \`${program}\` is not on PATH`];
  }
  const script = scriptOf(words);
  return script !== null && !scripts.has(script)
    ? [`command \`${line}\`: package.json has no script \`${script}\``]
    : [];
};
