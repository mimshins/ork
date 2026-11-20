/**
 * @file What the `permission` tool does with a shell line Claude Code asked
 *   about (RFC-028): allow it when every simple command in it is covered by the
 *   node's allow rules or Ork's shipped reads, deny it when a command matches
 *   or may match a deny rule, refuse it on a node whose unlisted commands are
 *   refused, and otherwise ask. A line the shell reader cannot take apart
 *   always asks. A path a command reads that a `Read(...)` deny rule names
 *   makes the line ask, and a shipped read of a path outside the session's
 *   folder is not covered.
 */

import { readShellLine, type ShellCommand } from "./shell-line.ts";
import { isShippedRead, SHIPPED_READS } from "./shell-safe.ts";

/** Where a path a command reads lies, as the session sees it. */
export type PathPlace = "inside" | "outside" | "denied";

/** The node's rules and the session's state the verdict reads. */
export type VerdictRules = {
  allow: readonly string[];
  deny: readonly string[];
  /** What happens to a command no rule covers; unset asks. */
  unlisted?: "refuse" | "ask";
  /** `ork run --yolo`: never refused (deny rules still apply). */
  yolo?: boolean | undefined;
  /**
   * The `extract` call to make instead, when the line reads files and the node
   * reads through `extract` (`shellReadReason`).
   */
  shellRead?: string;
  /**
   * Where a path lies: in the session's folder (or Ork's own), outside it, or
   * named by a `Read(...)` deny rule. Unset: every path is inside.
   */
  place?: (path: string) => PathPlace;
};

/**
 * The verdict on a shell line: `ask` carries the commands no rule covers, for
 * the prompt to offer a rule for; none when Ork offers only allow and deny.
 */
export type PermissionVerdict =
  | { verdict: "allow" }
  | { verdict: "deny"; message: string }
  | { verdict: "refuse"; message: string }
  | { verdict: "ask"; uncovered: ShellCommand[] };

/** Programs whose arguments name no file they read. */
const NO_FILES = new Set([
  "echo",
  "printf",
  "pwd",
  "basename",
  "dirname",
  "date",
  "true",
  "false",
  "ork",
  "pnpm",
]);

/** Programs that list names but read no file's content: any folder will do. */
const LISTS = new Set(["ls"]);

const norm = (text: string): string => text.trim().replaceAll(/\s+/gu, " ");

/** A `Bash` rule's pattern, `""` for every line; `undefined` for another tool. */
const bashPattern = (rule: string): string | undefined => {
  const match = /^Bash(?:\((.*)\))?$/su.exec(rule.trim());
  if (match === null) return undefined;
  const pattern = norm(match[1] ?? "");
  return pattern === "*" ? "" : pattern.replace(/:\*$/u, " *");
};

/** An allow rule covers a command as Claude Code reads a prefix rule. */
const allows = (pattern: string, command: string): boolean => {
  if (pattern === "") return true;
  if (!pattern.endsWith(" *")) return command === pattern;
  const head = pattern.slice(0, -2);
  return command === head || command.startsWith(`${head} `);
};

const escaped = (text: string): string =>
  text
    .split("*")
    .map(part => part.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
    .join(".*");

/**
 * A deny rule may match a command: every `*` in it matches anything, and a
 * command with an argument the shell expands may match a rule on its program.
 */
const mayDeny = (pattern: string, command: ShellCommand): boolean => {
  if (pattern === "") return true;
  const prefix = pattern.endsWith(" *");
  const shape = new RegExp(
    `^${escaped(prefix ? pattern.slice(0, -2) : pattern)}${prefix ? "(?: .*)?" : ""}$`,
    "su",
  );
  return (
    shape.test(command.text) ||
    shape.test(command.inner) ||
    // Quotes removed: `"rm" -rf x` is `rm -rf x`.
    shape.test(command.words.join(" ")) ||
    (command.dynamic.includes(true) &&
      pattern.split(" ")[0] === command.words[0])
  );
};

/** `word` as a path from the folder `base` (`""`: the session's). */
const joined = (base: string, word: string): string =>
  word.startsWith("/") || word.startsWith("~") || base === ""
    ? word
    : `${base}/${word}`;

/** Worst first: a path placed from several folders takes the worst place. */
const WORST: readonly PathPlace[] = ["denied", "outside", "inside"];

/** The most folders Ork follows in a line; more is one it can't place. */
const MAX_FOLDERS = 64;

/**
 * Every folder a command of the line may run in: the session's (`""`) and each
 * `cd` target, joined onto every folder found before it, in two passes, since a
 * loop may run its `cd` before a command that comes earlier in the line. `null`
 * when a `cd` can't be followed (`cd -`, an expanded folder). shortcut: two
 * passes model a loop running twice; a third pass through a link is not
 * followed (each path's links still are), upgrade if a case shows up.
 */
const foldersOf = (commands: readonly ShellCommand[]): string[] | null => {
  const folders = new Set([""]);
  for (let pass = 0; pass < 2; pass += 1) {
    for (const { words, dynamic } of commands) {
      if (words[0] !== "cd") continue;
      const args = words.slice(1);
      const to =
        args.find(word => word === "-" || !word.startsWith("-")) ?? "~";
      if (dynamic.slice(1).includes(true) || to === "-") return null;
      // A copy: the folders added now are joined on the next pass only.
      for (const from of Array.from(folders)) folders.add(joined(from, to));
      if (folders.size > MAX_FOLDERS) return null;
    }
  }
  return [...folders];
};

/** Where `word` lies, placed from each of `folders`: the worst place. */
const worstPlace = (
  folders: readonly string[] | null,
  place: (path: string) => PathPlace,
  word: string,
): PathPlace => {
  if (folders === null) return "denied";
  const found = new Set(folders.map(from => place(joined(from, word))));
  return WORST.find(each => found.has(each)) ?? "inside";
};

/**
 * Each command's paths, placed from every folder the line may run it in (the
 * worst place wins). A `cd` Ork can't follow makes every path of the line one
 * it can't place, so `denied`.
 */
const placesOf = (
  commands: readonly ShellCommand[],
  place: (path: string) => PathPlace,
): PathPlace[][] => {
  const folders = foldersOf(commands);
  const at = (word: string): PathPlace => worstPlace(folders, place, word);
  return commands.map(command => {
    const [program = "", ...args] = command.words;
    const dynamic = command.dynamic.slice(1);
    const inputs = command.inputs.map(at);
    if (program === "cd" || NO_FILES.has(program)) return inputs;
    const words = args.flatMap((word, index): PathPlace[] => {
      if (dynamic[index] === true) return ["outside"];
      if (!word.startsWith("-")) return [at(word)];
      const value = word.split("=").slice(1).join("=");
      return value === "" ? [] : [at(value)];
    });
    const found = [...inputs, ...words];
    return LISTS.has(program) ? found.filter(each => each === "denied") : found;
  });
};

/** Whether the node's allow rules or the shipped set cover `command`. */
const covered = (
  command: ShellCommand,
  allow: readonly string[],
  places: readonly PathPlace[],
): boolean => {
  const by = (text: string) => allow.some(pattern => allows(pattern, text));
  // A wrapper runs its inner command: a rule on the wrapper alone
  // (`Bash(timeout *)`) must not cover what it runs.
  const wrapped = command.wrappers.length > 0;
  const inner = by(norm(command.inner));
  // An assignment can change what runs, so only a rule on the whole command does.
  if (command.assignments.length > 0) {
    return by(norm(command.text)) && (!wrapped || inner);
  }
  if (inner || (!wrapped && by(norm(command.text)))) return true;
  return places.every(each => each === "inside") && isShippedRead(command);
};

const quoted = (texts: readonly string[]): string =>
  texts.map(text => `\`${text}\``).join(", ");

/** The refusal a model can act on: what the node may run, and what instead. */
const refusal = (
  uncovered: readonly ShellCommand[],
  bash: readonly string[],
  shellRead?: string,
): string =>
  [
    `Ork refused this call, so it did not run: this node runs only the shell commands its rules allow and Ork's shipped reads${
      uncovered.length === 0
        ? ""
        : `, and ${quoted(uncovered.map(each => each.text))} is not one of them`
    }.`,
    `Its Bash rules: ${bash.length === 0 ? "none" : quoted(bash)}.`,
    `Shipped reads: ${SHIPPED_READS}.`,
    shellRead ?? "Read files with the extract tool, not the shell.",
  ].join(" ");

/**
 * Whether the allow rules `allow` already cover every command the `Bash` rule
 * `rule` (a `ruleFor` rule, `Bash(<head> *)`) allows.
 */
export const allowsRule = (allow: readonly string[], rule: string): boolean => {
  const wanted = bashPattern(rule);
  if (wanted === undefined) return false;
  const head = wanted.endsWith(" *") ? wanted.slice(0, -2) : wanted;
  return allow.some(each => {
    const pattern = bashPattern(each);
    if (pattern === undefined) return false;
    if (pattern === wanted) return true;
    return (pattern === "" || pattern.endsWith(" *")) && allows(pattern, head);
  });
};

/** The verdict on the shell line `line` (the plan's order, RFC-028). */
export const permissionVerdict = (
  line: string,
  rules: VerdictRules,
): PermissionVerdict => {
  const read = readShellLine(line);
  if (read === null) return { verdict: "ask", uncovered: [] };
  const { commands } = read;
  const allow = rules.allow.flatMap(rule => bashPattern(rule) ?? []);
  const deny = rules.deny.flatMap(rule => bashPattern(rule) ?? []);
  if (commands.some(command => deny.some(each => mayDeny(each, command)))) {
    return { verdict: "deny", message: "denied for this node" };
  }
  const places = placesOf(commands, rules.place ?? (() => "inside"));
  const uncovered = commands.filter(
    (command, index) => !covered(command, allow, places[index] ?? []),
  );
  const refuses = rules.unlisted === "refuse" && rules.yolo !== true;
  const bash = rules.allow.filter(rule => bashPattern(rule) !== undefined);
  if (refuses && rules.shellRead !== undefined) {
    return {
      verdict: "refuse",
      message: refusal(uncovered, bash, rules.shellRead),
    };
  }
  if (places.flat().includes("denied"))
    return { verdict: "ask", uncovered: [] };
  if (uncovered.length === 0) return { verdict: "allow" };
  if (refuses) {
    return { verdict: "refuse", message: refusal(uncovered, bash) };
  }
  return { verdict: "ask", uncovered };
};
