/**
 * @file The read-only commands Ork ships (RFC-028): a simple command, as the
 *   shell reader gives it, that only reads and prints, so the `permission` tool
 *   may allow it on any node without a rule. Ork's own reads (`ork logs`, `ps`,
 *   `tree`, `usage`, `feedback list|show`, `follow-ups list|show`, also through
 *   `pnpm`) and a few filters are in; a program that can write a file, run
 *   another one or read files its arguments don't name is in only without that
 *   form (`sort -o`, `uniq` with an output file, `tail -f`, `date -s`, `jq -f`
 *   or `env`, `printf -v`, `sort` and `wc --files0-from`, `ork usage
 *   --clear-plan-limits`). An argument the shell expands is refused to a
 *   program with such a form, since it could expand to it.
 */

import type { ShellCommand } from "./shell-line.ts";

/** The shipped set in one line, for a message that names it. */
export const SHIPPED_READS =
  "`ork logs`, `ork ps`, `ork tree`, `ork usage`, `ork feedback list|show` and `ork follow-ups list|show` (also as `pnpm ork` or `pnpm -s ork`), `jq`, `wc`, `cut`, `sort`, `uniq`, `head`, `tail`, `tr`, `ls`, `echo`, `printf`, `pwd`, `basename`, `dirname`, `date`, `cd`, `true` and `false`, without a flag that writes a file, follows one or runs a program";

/** A short-option cluster (`-rn`) holding one of `letters`. */
const shortHas = (word: string, letters: string): boolean =>
  /^-[^-]/u.test(word) &&
  letters.split("").some(letter => word.slice(1).includes(letter));

/** A long option naming one of `names`, or a prefix of one, as GNU tools take. */
const longIs = (word: string, names: readonly string[]): boolean => {
  if (!word.startsWith("--")) return false;
  const name = word.slice(2).split("=")[0] ?? "";
  return name !== "" && names.some(each => each.startsWith(name));
};

/** The words that are not options, all of them after `--`. */
const operands = (args: readonly string[]): string[] => {
  const end = args.indexOf("--");
  const before = end < 0 ? args : args.slice(0, end);
  return [
    ...before.filter(word => word === "-" || !word.startsWith("-")),
    ...(end < 0 ? [] : args.slice(end + 1)),
  ];
};

/** `date`'s operands: words after an option that takes a value are its value. */
const dateOperands = (args: readonly string[]): string[] => {
  const found: string[] = [];
  for (let at = 0; at < args.length; at += 1) {
    const word = args[at] ?? "";
    if (
      ["--date", "--file", "--reference"].includes(word) ||
      /^-[^-]*[dfr]$/u.test(word)
    ) {
      at += 1;
    } else if (word === "-" || !word.startsWith("-")) {
      found.push(word);
    }
  }
  return found;
};

/** Jq's forms that read another file or the environment. */
const JQ_FILE_OPTIONS = [
  "from-file",
  "rawfile",
  "slurpfile",
  "argfile",
  "library-path",
];
const JQ_REACH = /\benv\b|\$ENV|input_filename|\bimport\b|\binclude\b/u;

/** Ork's reads: the subcommand, then its own; `args` start at the subcommand. */
const orkRead = (
  args: readonly string[],
  dynamic: readonly boolean[],
): boolean => {
  if (dynamic[0] === true) return false;
  const sub = args[0];
  if (sub === "logs" || sub === "ps" || sub === "tree") return true;
  if (sub === "usage") {
    return (
      !dynamic.includes(true) && !args.some(word => /^--?clear/iu.test(word))
    );
  }
  if (sub === "feedback" || sub === "follow-ups") {
    return dynamic[1] !== true && (args[1] === "list" || args[1] === "show");
  }
  return false;
};

/** A check per program, on its arguments; one with no check takes any. */
const CHECKS: Readonly<
  Record<string, (args: string[], dynamic: boolean[]) => boolean>
> = {
  ork: orkRead,
  pnpm: (args, dynamic) => {
    const at = args[0] === "-s" || args[0] === "--silent" ? 1 : 0;
    return (
      args[at] === "ork" &&
      dynamic[at] !== true &&
      orkRead(args.slice(at + 1), dynamic.slice(at + 1))
    );
  },
  // jq takes its long options by their whole name (`--arg` is not `--argfile`).
  jq: args =>
    !args.some(
      word =>
        shortHas(word, "fL") ||
        JQ_FILE_OPTIONS.some(name => word.startsWith(`--${name}`)) ||
        JQ_REACH.test(word),
    ),
  sort: args =>
    !args.some(
      word =>
        shortHas(word, "oT") ||
        longIs(word, [
          "output",
          "compress-program",
          "temporary-directory",
          // Reads every file the named file lists.
          "files0-from",
        ]),
    ),
  wc: args => !args.some(word => longIs(word, ["files0-from"])),
  uniq: args => operands(args).length <= 1,
  tail: args =>
    !args.some(
      word =>
        shortHas(word, "fF") ||
        longIs(word, ["follow"]) ||
        /^\+.*f/iu.test(word),
    ),
  date: args =>
    !args.some(word => shortHas(word, "s") || longIs(word, ["set"])) &&
    dateOperands(args).every(word => word.startsWith("+")),
  printf: args => !args.some(word => word.startsWith("-v")),
};

/** Programs with a form that writes or runs: an expanded argument may be it. */
const STRICT = new Set(["jq", "sort", "uniq", "tail", "date", "printf", "wc"]);

/** Programs that only read and print, whatever their arguments. */
const ANY = new Set([
  "cut",
  "head",
  "tr",
  "ls",
  "echo",
  "pwd",
  "basename",
  "dirname",
  "cd",
  "true",
  "false",
]);

/**
 * Whether the shipped set covers `command`: its program, by its bare name, is
 * one of the set and none of its arguments is a form the set refuses. A command
 * that runs with an assignment (`PATH=…`, `env LD_PRELOAD=…`) is never covered,
 * since the assignment can change what runs.
 */
export const isShippedRead = (command: ShellCommand): boolean => {
  const [program, ...args] = command.words;
  if (program === undefined || command.assignments.length > 0) return false;
  if (command.dynamic[0] === true || program.includes("/")) return false;
  if (ANY.has(program)) return true;
  const check = CHECKS[program];
  if (check === undefined) return false;
  const dynamic = command.dynamic.slice(1);
  if (STRICT.has(program) && dynamic.includes(true)) return false;
  return check(args, dynamic);
};
