/**
 * @file Tests for the read-only commands Ork ships (RFC-028): the evidence
 *   lines of run 92029b1e are covered with no rule, each program that can write
 *   or run another one is covered only without that form, and programs outside
 *   the set (unknown wrappers, interpreters, `sed`, `find`) never are.
 */

import { describe, expect, it } from "vitest";

import { readShellLine } from "../src/run/shell-line.ts";
import { isShippedRead, SHIPPED_READS } from "../src/run/shell-safe.ts";

/** Whether every command of `line` is a shipped read; false when unread. */
const covered = (line: string): boolean =>
  readShellLine(line)?.commands.every(isShippedRead) ?? false;

describe("isShippedRead", () => {
  it.each([
    "pnpm -s ork logs 92029b1e --json | jq '.[] | select(.type == \"node.ended\") | .node'",
    "for r in 88c3f7b5 92029b1e; do ork logs $r --json | jq -r '.[].type' | sort | uniq -c; done",
    "( pnpm -s ork logs 92029b1e | head -40 ); ls ~/.ork/projects",
    "timeout 60 pnpm -s ork logs 92029b1e --json | jq length",
    'for r in a b; do echo "== $r"; pnpm -s ork tree $r 2>/dev/null | head -20; done',
    "ork ps --limit 5 && ork usage --since 7d",
    "ork feedback list --json | jq '.[0]'; ork follow-ups show f1",
  ])("covers the evidence line %s", line => {
    expect(covered(line)).toBe(true);
  });

  it.each([
    "sort -k2 -t, -rn",
    "uniq -c",
    "uniq -c in.txt",
    "tail -n 20 a.log",
    "date +%F",
    "date -d tomorrow +%F",
    "date -u",
    "jq -r '.a' f.json",
    "jq --arg k v '.[$k]' f.json",
    "printf '%s\\n' a",
    "ork logs $r",
    "ork feedback show $X",
    "pnpm ork tree r1",
    "pnpm --silent ork follow-ups list",
    "cd .. && pwd && basename a/b && dirname a/b",
    "true || false",
    "wc -l < a.txt",
    "wc -lc a.txt b.txt",
    "cut -d, -f1 | tr a-z A-Z",
    "echo $HOME",
    "timeout 60 ork ps",
  ])("covers %s", line => {
    expect(covered(line)).toBe(true);
  });

  it.each([
    ["sort -o", "sort -o out.txt in.txt"],
    ["sort -o in a cluster", "sort -uo out.txt"],
    ["sort --output", "sort --output=out.txt"],
    ["sort --output abbreviated", "sort --out=out.txt"],
    ["sort --compress-program", "sort --compress-program=gzip"],
    ["sort -T", "sort -T /tmp"],
    ["sort with an expanded argument", "sort $X"],
    ["sort --files0-from", "sort --files0-from=list.txt"],
    ["sort --files0-from abbreviated", "sort --files0 list.txt"],
    ["wc --files0-from", "wc -c --files0-from=list.txt"],
    ["wc --files0-from apart", "wc --files0-from list.txt"],
    ["wc with an expanded argument", "wc -l $X"],
    ["uniq with an output file", "uniq in.txt out.txt"],
    ["uniq with an output file after options", "uniq -c in.txt out.txt"],
    ["uniq with an output file after --", "uniq -- in.txt -out"],
    ["uniq with an expanded argument", "uniq $X"],
    ["tail -f", "tail -f a.log"],
    ["tail -F", "tail -F a.log"],
    ["tail --follow", "tail --follow=name a.log"],
    ["tail -5f", "tail -5f a.log"],
    ["tail +5f", "tail +5f a.log"],
    ["tail with an expanded argument", "tail $X"],
    ["date -s", "date -s now"],
    ["date --set", "date --set=now"],
    ["date with a time to set", "date 0101"],
    ["date with an expanded argument", "date $X"],
    ["jq -f", "jq -f prog.jq"],
    ["jq -f in a cluster", "jq -rf prog.jq"],
    ["jq --from-file", "jq --from-file prog.jq"],
    ["jq --rawfile", "jq --rawfile a f ."],
    ["jq --slurpfile", "jq --slurpfile a f ."],
    ["jq --argfile", "jq --argfile a f ."],
    ["jq -L", "jq -L lib ."],
    ["jq env", "jq env"],
    ["jq $ENV", "jq '$ENV.HOME'"],
    ["jq input_filename", "jq input_filename f.json"],
    ["jq import", "jq 'import \"a\" as a; .'"],
    ["jq with an expanded program", 'jq "$P"'],
    ["printf -v", "printf -v PATH /tmp"],
    ["ork decide", "ork decide x"],
    ["ork decide through pnpm", "pnpm -s ork decide x"],
    ["ork decide under timeout", "timeout 60 ork decide x"],
    ["ork usage --clear-plan-limits", "ork usage --clear-plan-limits"],
    ["ork usage --clearPlanLimits", "ork usage --clearPlanLimits"],
    ["ork usage with an expanded argument", "ork usage $X"],
    ["ork with an expanded subcommand", "ork $SUB"],
    ["ork feedback accept", "ork feedback accept x"],
    ["ork follow-ups add", "ork follow-ups add"],
    ["ork stop", "ork stop r1"],
    ["pnpm install", "pnpm install"],
    ["pnpm exec", "pnpm exec ork logs"],
    ["npx", "npx ork logs"],
    ["sed", "sed -n 1p a.txt"],
    ["awk", "awk 1 a.txt"],
    ["find", "find ."],
    ["tee", "tee out.txt"],
    ["xargs", "xargs ls"],
    ["sudo", "sudo ls"],
    ["sh -c", "sh -c ls"],
    ["bash -c", "bash -c ls"],
    ["nohup", "nohup ls"],
    ["exec", "exec ls"],
    ["python", "python -c 1"],
    ["node", "node -e 1"],
    ["a program by path", "/bin/ls"],
    ["a program in this folder", "./ls"],
    ["an assignment", "HOME=/x ls"],
    ["an assignment through env", "env LD_PRELOAD=x.so ls"],
    ["env alone, which prints the environment", "env"],
    ["git", "git log"],
    ["a covered line with one command outside", "ls; rm -rf x"],
  ])("does not cover %s", (_form, line) => {
    expect(covered(line)).toBe(false);
  });

  it("names the set in one line", () => {
    expect(SHIPPED_READS).not.toContain("\n");
    expect(SHIPPED_READS).toContain("`jq`");
  });
});
