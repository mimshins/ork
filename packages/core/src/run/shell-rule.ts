/**
 * @file The rule a person may allow for a shell command Ork asked about
 *   (RFC-028): the command's program and subcommand with ` *` after them (`pnpm
 *   -s ork logs r1` gives `Bash(pnpm -s ork logs *)`, `git -C x log` gives
 *   `Bash(git log *)`), never past the subcommand. A program that runs another
 *   program or a script (an interpreter, a shell, `xargs`, `find`, `sed`,
 *   `awk`, `pnpm exec`, `npx`), one named by a path, one run with `NAME=value`
 *   assignments, and a program or subcommand the shell expands get no rule.
 */

import type { ShellCommand, ShellLine } from "./shell-line.ts";

/** Programs that run code they are handed, or another program: never a rule. */
const NEVER = new Set([
  // Interpreters and shells.
  "node",
  "nodejs",
  "deno",
  "bun",
  "tsx",
  "ts-node",
  "python",
  "python2",
  "python3",
  "ruby",
  "irb",
  "perl",
  "php",
  "lua",
  "luajit",
  "Rscript",
  "julia",
  "java",
  "osascript",
  "pwsh",
  "powershell",
  "tclsh",
  "sh",
  "bash",
  "zsh",
  "dash",
  "ksh",
  "fish",
  "csh",
  "tcsh",
  // Programs that run another program.
  "xargs",
  "find",
  "sed",
  "awk",
  "gawk",
  "mawk",
  "nawk",
  "env",
  "timeout",
  "time",
  "nice",
  "ionice",
  "nohup",
  "exec",
  "command",
  "builtin",
  "eval",
  "source",
  ".",
  "sudo",
  "doas",
  "su",
  "stdbuf",
  "watch",
  "strace",
  "ltrace",
  "script",
  "parallel",
  "chroot",
  "setsid",
  "flock",
  "unbuffer",
  "npx",
  "pnpx",
  "bunx",
  "uvx",
]);

/** A runner's subcommands that run a package or program they are handed. */
const NEVER_SUB: Readonly<Record<string, readonly string[]>> = {
  pnpm: ["exec", "dlx", "create"],
  npm: ["exec", "x", "init", "create"],
  yarn: ["exec", "dlx", "create"],
  uv: ["run", "tool"],
  poetry: ["run"],
  pipx: ["run"],
};

/**
 * The options a program takes before its subcommand: flags stay in the rule,
 * options with a value are left out with their value; any other option there
 * gives no rule, since it may take the word after it.
 */
type Globals = { flags: readonly string[]; values: readonly string[] };

const GLOBALS: Readonly<Record<string, Globals>> = {
  git: {
    flags: [
      "--no-pager",
      "-P",
      "--paginate",
      "-p",
      "--bare",
      "--no-optional-locks",
      "--literal-pathspecs",
      "--no-replace-objects",
    ],
    values: ["-C", "-c", "--git-dir", "--work-tree", "--namespace"],
  },
  pnpm: {
    flags: ["-s", "--silent", "-r", "--recursive", "-w", "--workspace-root"],
    values: ["-C", "--dir", "--filter", "-F"],
  },
  npm: { flags: ["-s", "--silent"], values: ["--prefix", "-w", "--workspace"] },
  yarn: { flags: ["-s", "--silent"], values: [] },
};

/**
 * Runners whose subcommand names a script or a program, which has a subcommand
 * of its own (`pnpm -s ork logs`); `run` names the script in the next word.
 */
const RUNNERS = new Set(["pnpm", "npm", "yarn"]);

/** A word that reads as a command's name, not as an argument or a path. */
const NAME = /^[a-z][a-z0-9-]*(?::[a-z0-9-]+)*$/u;

/** A word a rule can hold as it is: no blank, quote, glob or parenthesis. */
const LITERAL = /^[\w@%+=:,./-]+$/u;

/**
 * The prefix rule that allows `command` and its kind (`Bash(git log *)`), or
 * `null` when Ork does not generalise it.
 */
export const ruleFor = (command: ShellCommand): string | null => {
  const { words, dynamic } = command;
  const program = words[0];
  if (
    program === undefined ||
    dynamic[0] === true ||
    command.assignments.length > 0 ||
    program.includes("/") ||
    NEVER.has(program)
  ) {
    return null;
  }
  const kept = [program];
  let at = 1;
  const globals = GLOBALS[program];
  if (globals !== undefined) {
    for (; words[at]?.startsWith("-") === true; at += 1) {
      const word = words[at] ?? "";
      const [name = ""] = word.split("=");
      if (dynamic[at] === true) return null;
      if (globals.flags.includes(word)) {
        kept.push(word);
      } else if (globals.values.includes(word)) {
        at += 1;
      } else if (!globals.values.includes(name) || !word.includes("=")) {
        return null;
      }
    }
  }
  // The next word, kept when it reads as a name; `null` when the shell expands
  // it, since it could be any subcommand.
  const take = (): string | undefined | null => {
    const word = words[at];
    if (dynamic[at] === true) return null;
    if (word === undefined || !NAME.test(word)) return undefined;
    at += 1;
    kept.push(word);
    return word;
  };
  const sub = take();
  if (sub === null || NEVER_SUB[program]?.includes(sub ?? "") === true) {
    return null;
  }
  // A program with subcommands and none named: the rule would cover them all.
  if (sub === undefined && globals !== undefined) return null;
  if (sub !== undefined && RUNNERS.has(program)) {
    const script = sub === "run" || sub === "run-script" ? take() : sub;
    if (script === null || script === undefined || NEVER.has(script)) {
      return null;
    }
    // The script's own subcommand (`ork logs`), and no further.
    if (take() === null) return null;
  }
  if (!kept.every(word => LITERAL.test(word))) return null;
  return `Bash(${kept.join(" ")} *)`;
};

/**
 * The rules that allow every command of `line` that `covered` does not: one per
 * command, each once, in order; `null` when one of them has no rule.
 */
export const rulesFor = (
  line: ShellLine,
  covered: (command: ShellCommand) => boolean,
): string[] | null => {
  const rules: string[] = [];
  for (const command of line.commands) {
    if (!covered(command)) {
      const rule = ruleFor(command);
      if (rule === null) return null;
      if (!rules.includes(rule)) rules.push(rule);
    }
  }
  return rules;
};
