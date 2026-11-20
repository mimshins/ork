/**
 * @file Tests for the rule a person may allow for a shell command (RFC-028):
 *   program and subcommand with ` *`, global options of git and pnpm, a
 *   runner's script and its subcommand, never past the subcommand, and no rule
 *   for an interpreter, a wrapper, a program that runs another, a path, an
 *   assignment or a word the shell expands; and the rules of a line's uncovered
 *   commands.
 */

import { describe, expect, it } from "vitest";

import { readShellLine, type ShellLine } from "../src/run/shell-line.ts";
import { ruleFor, rulesFor } from "../src/run/shell-rule.ts";

/** The line's reading; it must be readable. */
const read = (line: string): ShellLine => {
  const found = readShellLine(line);
  if (found === null) throw new Error(`unread: ${line}`);
  return found;
};

/** The rule for the line's only command. */
const rule = (line: string): string | null => {
  const [command, ...more] = read(line).commands;
  if (command === undefined || more.length > 0) throw new Error(line);
  return ruleFor(command);
};

describe("ruleFor", () => {
  it.each([
    ["pnpm -s ork logs r1 --json", "Bash(pnpm -s ork logs *)"],
    ["pnpm --silent ork ps", "Bash(pnpm --silent ork ps *)"],
    ["pnpm ork tree r1", "Bash(pnpm ork tree *)"],
    ["pnpm run build --x", "Bash(pnpm run build *)"],
    ["pnpm --filter core test", "Bash(pnpm test *)"],
    ["pnpm vitest run packages/a.test.ts", "Bash(pnpm vitest run *)"],
    ["pnpm check:fast", "Bash(pnpm check:fast *)"],
    ["pnpm test packages/core", "Bash(pnpm test *)"],
    ["npm run lint -- --fix", "Bash(npm run lint *)"],
    ["git -C x log", "Bash(git log *)"],
    ["git -c core.pager=less log -5", "Bash(git log *)"],
    ["git --git-dir=/x status", "Bash(git status *)"],
    ["git --no-pager diff HEAD", "Bash(git --no-pager diff *)"],
    ["git stash list", "Bash(git stash *)"],
    ["ork logs r1 --json", "Bash(ork logs *)"],
    ["gh pr list --json x", "Bash(gh pr *)"],
    ["wc -l a.ts", "Bash(wc *)"],
    ["cat README.md", "Bash(cat *)"],
    ["ls", "Bash(ls *)"],
    ["timeout 60 pnpm test", "Bash(pnpm test *)"],
    ["( jq -r .a x.json )", "Bash(jq *)"],
  ])("generalises %j to %s", (line, expected) => {
    expect(rule(line)).toBe(expected);
  });

  it.each([
    ["an interpreter", "node x.js"],
    ["python", "python3 -c 'print(1)'"],
    ["a shell", "sh -c ls"],
    ["bash", "bash x.sh"],
    ["xargs", "xargs rm"],
    ["find", "find . -name x"],
    ["sed", "sed -n 1p x"],
    ["awk", "awk '{print}' x"],
    ["npx", "npx tsc"],
    ["pnpm exec", "pnpm exec tsc"],
    ["pnpm dlx", "pnpm dlx cowsay"],
    ["npm exec", "npm exec x"],
    ["a script run through pnpm by an interpreter", "pnpm node x.js"],
    ["sudo", "sudo ls"],
    ["nohup", "nohup ls"],
    ["a program by its path", "./scripts/x.sh"],
    ["an absolute program", "/usr/bin/git log"],
    ["an assignment", "FOO=1 git log"],
    ["an expanded subcommand", "git $SUB"],
    ["an expanded runner script", "pnpm run $S"],
    ["an expanded script subcommand", "pnpm -s ork $X"],
    ["an expanded first argument", "ork $X"],
    ["git with no subcommand", "git --no-pager"],
    ["git with an unknown option", "git --bogus log"],
    ["pnpm run with no script", "pnpm run"],
    ["a word a rule can't hold", "'my tool' x"],
  ])("gives no rule to %s", (_form, line) => {
    expect(rule(line)).toBeNull();
  });
});

/** Covers the commands of one program. */
const covered =
  (program: string) =>
  (command: { words: string[] }): boolean =>
    command.words[0] === program;

describe("rulesFor", () => {
  it("gives one rule per uncovered command, each once", () => {
    expect(
      rulesFor(
        read("for r in a b; do ork logs $r | jq .x; ork logs $r; done; ls"),
        covered("jq"),
      ),
    ).toEqual(["Bash(ork logs *)", "Bash(ls *)"]);
  });

  it("gives none when every command is covered", () => {
    expect(rulesFor(read("ls; ls -la"), covered("ls"))).toEqual([]);
  });

  it("gives no rules when an uncovered command has none", () => {
    expect(rulesFor(read("ork logs r1 | sh"), covered("jq"))).toBeNull();
  });
});
