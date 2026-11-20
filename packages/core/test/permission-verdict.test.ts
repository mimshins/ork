/**
 * @file Tests for the verdict on a shell line (RFC-028): what `ask` carries,
 *   how a `cd` moves the paths commands read (from every folder a loop may run
 *   them in), a path whose value the shell expands, an assignment that only a
 *   rule on the whole command covers, a quoted program a deny rule names, and a
 *   wrapper whose own rule does not cover what it runs. The `permission` tool's
 *   own tests cover the rest.
 */

import { describe, expect, it } from "vitest";

import {
  type PathPlace,
  permissionVerdict,
  type VerdictRules,
} from "../src/run/permission-verdict.ts";

/** Absolute paths are outside; `secrets/…` is denied; the rest inside. */
const place = (path: string): PathPlace => {
  if (path.startsWith("/")) return "outside";
  return path.startsWith("secrets") ? "denied" : "inside";
};

const RULES: VerdictRules = { allow: [], deny: [], place };

/** As `place`, and `sub/sub/…` is outside, as if `sub/sub` linked out. */
const deepPlace = (path: string): PathPlace =>
  path.startsWith("sub/sub/") ? "outside" : place(path);

/** The verdict's kind and, for `ask`, the uncovered commands' text. */
const judged = (line: string, rules: VerdictRules = RULES) => {
  const verdict = permissionVerdict(line, rules);
  return verdict.verdict === "ask"
    ? { ask: verdict.uncovered.map(command => command.text) }
    : verdict.verdict;
};

describe("permissionVerdict", () => {
  it("asks with the commands no rule covers", () => {
    expect(judged("ork logs r1 | jq . && pnpm test --run")).toEqual({
      ask: ["pnpm test --run"],
    });
  });

  it("asks with no command to generalise for a line it cannot read", () => {
    expect(judged("cat `ls`")).toEqual({ ask: [] });
  });

  it("reads later paths from the folder a cd moved to", () => {
    expect(judged("cd sub && wc -l a.ts")).toBe("allow");
    expect(judged("cd /etc && wc -l hosts")).toEqual({ ask: ["wc -l hosts"] });
    expect(judged("cd - && wc -l a.ts")).toEqual({ ask: [] });
    expect(judged("cd $HOME && wc -l a.ts")).toEqual({ ask: [] });
  });

  it.each([
    [
      "a cd later in a for loop",
      "for i in 1 2; do wc -c etc/passwd; cd /; done",
    ],
    [
      "a cd later in a while loop",
      "while true; do head etc/passwd; cd /; done",
    ],
    [
      "a cd later in an until loop",
      "until false; do tail etc/passwd; cd /; done",
    ],
    ["a cd in a subshell before", "( cd / ); wc -c etc/passwd"],
    ["a relative cd run twice", "for i in 1 2; do cd sub; wc -c x; done"],
  ])(
    "places a path from every folder the line may run it in: %s",
    (_form, line) => {
      expect(judged(line, { ...RULES, place: deepPlace })).not.toBe("allow");
    },
  );

  it("makes every path of the line unplaceable after a cd it can't follow", () => {
    expect(judged("wc -l a.ts; cd -")).toEqual({ ask: [] });
  });

  it("does not place a path the shell expands", () => {
    expect(judged("wc -l $FILE")).toEqual({ ask: ["wc -l $FILE"] });
  });

  it("covers a command run with an assignment only by a rule on all of it", () => {
    const rules = { ...RULES, allow: ["Bash(git status)"] };
    expect(judged("FOO=1 git status", rules)).toEqual({
      ask: ["FOO=1 git status"],
    });
    expect(
      judged("FOO=1 git status", {
        ...rules,
        allow: ["Bash(FOO=1 git status)"],
      }),
    ).toBe("allow");
  });

  it("denies a command a deny rule may match through an expanded argument", () => {
    expect(
      judged("git $SUB origin", { ...RULES, deny: ["Bash(git push *)"] }),
    ).toBe("deny");
  });

  it("denies a quoted program a deny rule names", () => {
    expect(judged(`"rm" -rf x`, { ...RULES, deny: ["Bash(rm *)"] })).toBe(
      "deny",
    );
  });

  it.each([
    ["timeout 5 rm -rf x", "Bash(timeout *)"],
    ["nice -n 5 rm -rf x", "Bash(nice *)"],
    ["env A=1 rm -rf x", "Bash(env *)"],
  ])("does not let a rule on the wrapper cover %s", (line, rule) => {
    expect(judged(line, { ...RULES, allow: [rule] })).toEqual({ ask: [line] });
  });

  it("covers a wrapped command its inner rule or the shipped set covers", () => {
    const rules = { ...RULES, allow: ["Bash(pnpm test *)"] };
    expect(judged("timeout 60 pnpm test --run", rules)).toBe("allow");
    expect(judged("timeout 60 ork ps")).toBe("allow");
  });

  it("refuses under unlisted: refuse with what the node may run", () => {
    const verdict = permissionVerdict("pnpm test", {
      ...RULES,
      allow: ["Bash(git status)", "Read"],
      unlisted: "refuse",
    });
    expect(verdict).toMatchObject({ verdict: "refuse" });
    expect(JSON.stringify(verdict)).toContain(
      "Its Bash rules: `Bash(git status)`.",
    );
  });
});
