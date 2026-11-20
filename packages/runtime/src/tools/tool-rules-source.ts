/**
 * @file The matcher a driver's own hook carries to hold a session to its node's
 *   tool rules (RFC-014, deny by default), as JavaScript source: Command Code's
 *   mod (`command-code-mod.ts`) and Codex's hook both embed it, each with its
 *   tool's names. The rules are the node's, in Claude Code's words
 *   (`Bash(git:*)`, `Read`, `mcp__github`); a specifier Ork does not read never
 *   allows a call and always denies one. A shell line is read by core's shell
 *   reader (`readShellLine`, embedded by its source) and checked command by
 *   command, inside subshells, loops and `if` too: each must be allowed, and a
 *   line the reader can't read (a substitution, `eval`, a heredoc) is allowed
 *   only by a plain `Bash` rule. Ork's own tools (`mcp__ork__*`) always go
 *   through, and the tool's read tools need no rule inside the worktree (by its
 *   real path, links followed), as with Claude Code. A yolo run (`ork run
 *   --yolo`) allows every call the node's `deny` and `only` don't refuse. Under
 *   a write limit (`writeOnly`), an edit whose files are outside those folders
 *   (links followed), or named CLAUDE.md or AGENTS.md, is refused, yolo or not
 *   (`write-limit.ts`).
 */

import { readShellLine, type SessionSpec } from "@krapht/ork-core";

import { shellReadReason, textReadReason } from "./shell-reads.ts";
import { writeOnlyReason } from "./write-limit.ts";

/** What the matcher enforces: the node's lists, and the worktree reads stay in. */
export type ToolRuleSet = {
  cwd: string;
  allow: string[];
  deny: string[];
  only?: string[];
  /** `ork run --yolo`: what deny and only don't refuse is allowed. */
  yolo?: boolean;
  /** Shell reads are refused with the `extract` call to make (RFC-025). */
  refuseReads?: boolean;
  /** A Read of a text file is refused too: the node cannot edit. */
  refuseTextReads?: boolean;
  /** Edits only under these folders of `cwd`, never CLAUDE.md or AGENTS.md. */
  writeOnly?: string[];
};

/** The rules of a session: an `acceptEdits` node may edit without a rule. */
export const toolRuleSet = (spec: SessionSpec): ToolRuleSet => ({
  cwd: spec.cwd,
  allow: [
    ...spec.tools.allow,
    ...(spec.permissionMode === "acceptEdits" ? ["Edit"] : []),
  ],
  deny: spec.tools.deny,
  ...(spec.tools.only === undefined ? {} : { only: spec.tools.only }),
  ...(spec.yolo === true ? { yolo: true } : {}),
  ...(spec.reading === "open" ? {} : { refuseReads: true }),
  ...(spec.reading === "extract-only" ? { refuseTextReads: true } : {}),
  ...(spec.writeOnly === undefined ? {} : { writeOnly: spec.writeOnly }),
});

/**
 * The files an edit call names, by default: every string under a key that reads
 * as a path (`path`, `file_path`); `null` for none.
 */
const pathKeyFiles = (
  _name: string,
  input: Record<string, unknown> | undefined,
): string[] | null => {
  const found = Object.entries(input ?? {}).flatMap(([key, value]) =>
    /path|file/iu.test(key) && typeof value === "string" ? [value] : [],
  );
  return found.length === 0 ? null : found;
};

/** A tool's own words, which the matcher reads a call's name in. */
export type ToolWords = {
  /** The tool's names, as Ork (and Claude Code) names them. */
  tools: Readonly<Record<string, string>>;
  /** The tool's read tools: inside the worktree they need no rule. */
  reads: readonly string[];
  /** The tool's own tools that always go through. */
  meta: readonly string[];
  /** A rule's word, lower case, and the Ork tool names it covers. */
  covers: Readonly<Record<string, readonly string[]>>;
  /**
   * JavaScript source of `(name, input) => string[] | null`: the files an edit
   * call (Ork's `Edit` or `Write`) names, for the write limit; `null` when it
   * names none the matcher can read. Default: the strings under path keys.
   */
  editPaths?: string;
};

/**
 * The matcher's source: plain JavaScript for an ES module, ending in an
 * exported `decide(name, input)` that gives `undefined` for a call that may
 * run, a reason for one refused, or `{ read }` for a read refused with the
 * `extract` call to make.
 */
export const toolRulesSource = (
  rules: ToolRuleSet,
  words: ToolWords,
): string => `import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
const RULES = ${JSON.stringify(rules)};
const shellReadReason = ${shellReadReason.toString()};
const textReadReason = ${textReadReason.toString()};
const writeOnlyReason = ${writeOnlyReason.toString()};
const editFilesOf = ${words.editPaths ?? pathKeyFiles.toString()};
const EDITS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const META = new Set(${JSON.stringify(words.meta)});
// Reads a session makes in its worktree without a rule, as Claude Code does.
const READS = new Set(${JSON.stringify(words.reads)});
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
const TOOLS = ${JSON.stringify(words.tools)};
// A rule's word, as the tool reads it, covers these of Ork's tool names.
const COVERS = ${JSON.stringify(words.covers)};
const norm = text => text.trim().replace(/\\s+/g, " ");
const split = rule => {
  const at = rule.indexOf("(");
  return at < 0 || !rule.endsWith(")")
    ? { token: rule.trim() }
    : { token: rule.slice(0, at).trim(), spec: rule.slice(at + 1, -1) };
};
// The simple commands of a shell line, as core's reader takes it apart (lists,
// pipes, subshells, loops, if); null when it can't read the line with
// certainty: a substitution, eval, a heredoc, a write to a file, an unclosed
// quote, or nothing at all.
const readShellLine = ${readShellLine.toString()};
// The calls a rule is checked against: a shell line's simple commands, each
// alone as written; one Ork can't read has no command, so only a plain rule
// covers it.
const callsOf = (name, input) => {
  if ((TOOLS[name] ?? name) !== "Bash" || typeof input?.command !== "string") return [input];
  const line = readShellLine(input.command);
  return line === null ? [{}] : line.commands.map(each => ({ ...input, command: each.text }));
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
// The write limit: an edit's files, links followed, relative to the worktree;
// one from the home folder is outside it.
const written = (name, input) => {
  const paths = editFilesOf(name, input);
  return paths === null ? null : paths.map(each => each.startsWith("~") ? "../" + each : relative(ROOT, real(resolve(RULES.cwd, each))));
};
export const decide = (name, input) => {
  const calls = callsOf(name, input);
  if (anyDenied(name, calls)) return "denied for this node";
  if (RULES.writeOnly !== undefined && EDITS.has(TOOLS[name] ?? name)) {
    const why = writeOnlyReason(written(name, input), RULES.writeOnly);
    if (why !== undefined) return why;
  }
  if (RULES.refuseReads === true && (TOOLS[name] ?? name) === "Bash" && typeof input?.command === "string") {
    const read = shellReadReason(input.command);
    if (read !== undefined) return { read };
  }
  if (RULES.refuseTextReads === true && (TOOLS[name] ?? name) === "Read") {
    const read = pathsOf(input).map(textReadReason).find(each => each !== undefined);
    if (read !== undefined) return { read };
  }
  if (name.startsWith("mcp__ork__") || META.has(name)) return undefined;
  if (RULES.only !== undefined && !allCovered(RULES.only, name, calls)) {
    return "not one of this node's tools";
  }
  if (RULES.yolo === true) return undefined;
  if (READS.has(name) && inside(input)) return undefined;
  if (allCovered(RULES.allow, name, calls)) return undefined;
  return "not allowed for this node";
};
`;
