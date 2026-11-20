/**
 * @file Tests for the shell line reader (RFC-028): the forms it takes apart
 *   (lists, pipes, subshells, loops, `if`, wrappers, assignments, redirects to
 *   /dev/null), the forms it must leave unread (substitutions, heredocs,
 *   `eval`, functions, `case`, groups, a variable or glob as the program,
 *   unclosed quotes, a redirect to a file), a property test over generated
 *   lines, and its source run alone, as a guard embeds it.
 */

import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

import { readShellLine } from "../src/run/shell-line.ts";

const programs = (line: string): string[] | undefined =>
  readShellLine(line)?.commands.map(command => command.words[0] ?? "");

const first = (line: string) => readShellLine(line)?.commands[0];

describe("readShellLine", () => {
  it("splits lists and pipes, and reads quotes", () => {
    expect(programs("a; b && c || d | e & f |& g")).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
      "g",
    ]);
    expect(programs("a\nb\r\nc")).toEqual(["a", "b", "c"]);
    expect(first(`git commit -m "a; b && c | d"`)?.words).toEqual([
      "git",
      "commit",
      "-m",
      "a; b && c | d",
    ]);
    expect(first("git commit -m '$(x)'")?.words).toEqual([
      "git",
      "commit",
      "-m",
      "$(x)",
    ]);
    expect(first(String.raw`echo a\ b "c\"d" 'e'f`)?.words).toEqual([
      "echo",
      "a b",
      'c"d',
      "ef",
    ]);
    expect(programs("ls # rm -rf /\nwc")).toEqual(["ls", "wc"]);
  });

  it("reads subshells, loops and if", () => {
    expect(
      programs("( pnpm -s ork logs r | head ); ls ~/.ork/projects"),
    ).toEqual(["pnpm", "head", "ls"]);
    expect(
      programs("for r in a b; do ork logs $r --json; done | head -5"),
    ).toEqual(["ork", "head"]);
    expect(programs("for r in a b\ndo\n  echo $r\ndone")).toEqual(["echo"]);
    expect(
      programs("while true; do ls; done; until false; do pwd; done"),
    ).toEqual(["true", "ls", "false", "pwd"]);
    expect(
      programs("if ls a; then echo y; elif ls b; then echo z; else echo n; fi"),
    ).toEqual(["ls", "echo", "ls", "echo", "echo"]);
    expect(
      programs("(for r in a; do (if true; then wc; fi); done) 2>/dev/null"),
    ).toEqual(["true", "wc"]);
    expect(programs("echo do done fi then")).toEqual(["echo"]);
  });

  it("peels wrappers and assignments", () => {
    expect(first("timeout 60 ork decide x")).toEqual({
      text: "timeout 60 ork decide x",
      inner: "ork decide x",
      words: ["ork", "decide", "x"],
      dynamic: [false, false, false],
      wrappers: [["timeout", "60"]],
      assignments: [],
      inputs: [],
    });
    expect(
      first("HOME=/tmp env -i A=1 nice -n 5 time -p timeout -s KILL 5s ls -l"),
    ).toMatchObject({
      inner: "ls -l",
      words: ["ls", "-l"],
      wrappers: [
        ["env", "-i", "A=1"],
        ["nice", "-n", "5"],
        ["time", "-p"],
        ["timeout", "-s", "KILL", "5s"],
      ],
      assignments: ["HOME=/tmp", "A=1"],
    });
    expect(first("env")?.words).toEqual(["env"]);
    expect(first("env -i")?.words).toEqual(["env", "-i"]);
    expect(first("nice")?.wrappers).toEqual([]);
    expect(first("cd .. && ls")?.words).toEqual(["cd", ".."]);
  });

  it("keeps redirects to /dev/null or a stream, and `<` from a path", () => {
    expect(first("ls 2>/dev/null")?.text).toBe("ls 2>/dev/null");
    expect(first("ls > /dev/null 2>&1")?.words).toEqual(["ls"]);
    expect(first("ls &>/dev/null >&2 2>&-")?.words).toEqual(["ls"]);
    expect(first("wc -l < a.txt")).toMatchObject({
      words: ["wc", "-l"],
      inputs: ["a.txt"],
    });
    expect(first("echo a2>/dev/null")?.words).toEqual(["echo", "a2"]);
  });

  it("marks the words the shell expands", () => {
    expect(
      first(
        String.raw`echo $HOME "$x" *.ts '$y' \$z a{b,c} ~/x $'\t' $` + "{n}",
      )?.dynamic,
    ).toEqual([false, true, true, true, false, false, true, false, true, true]);
  });

  it.each([
    ["a redirect to a file", "echo x > out.txt"],
    ["an append to a file", "echo x >> out"],
    ["stderr to a file", "ls 2>err.log"],
    ["a clobber", "ls >| f"],
    ["both streams to a file", "ls &> f"],
    ["a stream copy to a name", "ls >&out"],
    ["a redirect to a variable", "ls > $F"],
    ["a read-write open", "ls <> f"],
    ["an input copy", "ls <&3"],
    ["an input from a variable", "wc < $F"],
    ["a command substitution", "ls $(pwd)"],
    ["a quoted command substitution", `ls "$(pwd)"`],
    ["backticks", "ls `pwd`"],
    ["quoted backticks", 'echo "`id`"'],
    ["arithmetic", "echo $((1+2))"],
    ["a parameter operator", "echo ${x:-y}"],
    ["process substitution in", "diff <(ls) <(ls)"],
    ["process substitution out", "ls >(cat)"],
    ["eval", "eval ls"],
    ["eval after a wrapper", "timeout 5 eval ls"],
    ["a heredoc", "cat <<EOF\nx\nEOF"],
    ["a here-string", "cat <<< x"],
    ["a function keyword", "function f { ls; }"],
    ["a function definition", "f() { ls; }"],
    ["case", "case x in a) ls;; esac"],
    ["a group", "{ ls; }"],
    ["a variable as the program", "$CMD x"],
    ["a braced variable as the program", "${CMD} x"],
    ["a glob as the program", "*.sh"],
    ["a partly expanded program", "./x$Y"],
    ["a variable after a wrapper", "timeout 5 $CMD"],
    ["an unclosed single quote", "echo 'a"],
    ["an unclosed double quote", 'echo "a'],
    ["a trailing backslash", "echo a\\"],
    ["a for over a glob", "for f in *.ts; do wc $f; done"],
    ["a for over a substitution", "for f in $(ls); do wc $f; done"],
    ["a for over a variable", "for f in $LIST; do wc $f; done"],
    ["a for with no list", "for f; do wc $f; done"],
    ["an arithmetic for", "for ((i=0;i<3;i++)); do ls; done"],
    ["negation", "! ls"],
    ["a test keyword", "[[ -f x ]]"],
    ["a substituted assignment", "X=$(id) ls"],
    ["an expanded assignment", "X=$Y ls"],
    ["an assignment alone", "PATH=/tmp"],
    ["an array assignment", "A=(1 2) ls"],
    ["an expanded wrapper argument", "timeout $T ls"],
    ["env -S", "env -S 'ls -l'"],
    ["env --split-string", "env --split-string=ls x"],
    ["env -C", "env -C / head -5 etc/passwd"],
    ["env -C joined", "env -C/ head -5 etc/passwd"],
    ["env --chdir", "env --chdir / head -5 etc/passwd"],
    ["env --chdir=", "env --chdir=/ head -5 etc/passwd"],
    ["an unknown timeout option", "timeout --bogus 5 ls"],
    ["timeout with no command", "timeout 5"],
    ["a case terminator", "ls ;; x"],
    ["an unclosed subshell", "( ls"],
    ["a stray close", "ls )"],
    ["an unfinished if", "if ls; then echo"],
    ["an unfinished loop", "while ls; do ls"],
    ["a dangling and", "ls &&"],
    ["a dangling pipe", "ls |"],
    ["a stray keyword", "done"],
    ["an empty subshell", "( )"],
    ["a compound read from a file", "while true; do ls; done < f"],
    ["nothing", ""],
    ["only a comment", "# ls"],
  ])("leaves %s unread", (_form, line) => {
    expect(readShellLine(line)).toBeNull();
  });
});

/** A small seeded generator, so a failure repeats. */
const randomOf = (seed: number): (() => number) => {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
};

const SAFE = [
  "ls",
  "ork logs r1 --json",
  "jq -r '.a'",
  "wc -l",
  'echo "x y"',
  "for r in a b; do echo $r; done",
  "( head -3 )",
  "timeout 5 sort",
  "if true; then pwd; fi",
];
const SEPARATORS = ["; ", " | ", " && ", " || ", "\n", " & "];
/** Dangers that work bare or inside double quotes. */
const QUOTABLE = ["`id`", "$(id)", "$((1+1))"];
/** Dangers that work bare only. */
const BARE = ["<(ls)", ">(cat)", "<<EOF", "<<<x", "'open", '"open'];

/** A line of safe commands with one danger put in at random. */
const dangerousLine = (random: () => number): string => {
  const pick = (list: readonly string[]): string =>
    list[Math.floor(random() * list.length)] ?? "";
  const commands = Array.from({ length: 1 + Math.floor(random() * 4) }, () =>
    pick(SAFE),
  );
  const quoted = random() < 0.5;
  const danger = quoted
    ? `"a${pick(QUOTABLE)}b"`
    : pick([...QUOTABLE, ...BARE]);
  const at = Math.floor(random() * commands.length);
  commands[at] = `${pick(["echo", "ls", "jq", "wc"])} x ${danger}`;
  return commands
    .map((command, index) =>
      index === 0 ? command : pick(SEPARATORS) + command,
    )
    .join("");
};

describe("readShellLine on generated lines", () => {
  it("reads no line holding a substitution, a heredoc or an unclosed quote", () => {
    const random = randomOf(28);
    const lines = Array.from({ length: 2000 }, () => dangerousLine(random));
    expect(lines.filter(line => readShellLine(line) !== null)).toEqual([]);
  });

  it("reads the safe lines it is made of", () => {
    expect(SAFE.filter(line => readShellLine(line) === null)).toEqual([]);
  });
});

describe("readShellLine's source", () => {
  it("runs alone, as a guard embeds it", () => {
    const lines = [
      ...SAFE,
      "timeout 60 ork decide x",
      "ls $(pwd)",
      "echo 'a",
      "for f in *.ts; do wc $f; done",
    ];
    const embedded: unknown = runInNewContext(
      `JSON.stringify(LINES.map(${readShellLine.toString()}))`,
      { LINES: lines },
    );
    expect(embedded).toBe(
      JSON.stringify(lines.map(line => readShellLine(line))),
    );
  });
});
