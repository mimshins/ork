/**
 * @file Tests for the check `ork onboard` runs on the proposer's list: a
 *   suggestion that cites a file or commit that is not there, drafts a command
 *   whose program or package script does not exist, repeats a workflow or is
 *   past the tenth is dropped with its reasons; the rest are kept; malformed
 *   entries and input are tolerated (G21); and nothing the model drafted runs.
 */

import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { filterSuggestions } from "../src/onboard/verbs-filter.ts";

const PATH_BEFORE = process.env["PATH"];

// The machine may have no `yarn` or `bun`: stubs stand in, and are never run.
beforeAll(() => {
  const stubs = mkdtempSync(path.join(tmpdir(), "ork-stubs-"));
  for (const name of ["npm", "pnpm", "yarn", "bun"]) {
    writeFileSync(path.join(stubs, name), "#!/bin/sh\nexit 0\n");
    chmodSync(path.join(stubs, name), 0o755);
  }
  process.env["PATH"] = `${stubs}${path.delimiter}${PATH_BEFORE ?? ""}`;
});

afterAll(() => {
  process.env["PATH"] = PATH_BEFORE;
});

const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

/** A repository with one commit, a `package.json` and an executable script. */
const repo = (): { root: string; commit: string } => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-filter-")));
  git(root, "init", "-q");
  git(root, "config", "user.email", "t@example.com");
  git(root, "config", "user.name", "T");
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ scripts: { test: "vitest", "lint:fix": "oxlint" } }),
  );
  mkdirSync(path.join(root, "scripts"));
  const script = path.join(root, "scripts", "check.sh");
  writeFileSync(script, "#!/bin/sh\ntouch ../ran\n");
  chmodSync(script, 0o755);
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "first");
  return { root, commit: git(root, "rev-parse", "HEAD") };
};

const entry = (
  over: Record<string, unknown> = {},
): Record<string, unknown> => ({
  workflow: "ci",
  why: "CI is slow",
  decidedBy: "a review gate",
  caps: { budgetUsd: 2, budgetTokens: 400000 },
  evidence: [{ path: "package.json" }],
  ...over,
});

const reasonsOf = (over: Record<string, unknown>): string[] => {
  const { root } = repo();
  const { kept, dropped } = filterSuggestions([entry(over)], root);
  return kept.length > 0 ? [] : (dropped[0]?.reasons ?? []);
};

describe("filter", () => {
  it("keeps a good suggestion whole, with a commit and commands", () => {
    const { root, commit } = repo();
    const good = entry({
      evidence: [{ path: "scripts" }, { commit: commit.slice(0, 8) }],
      commands: [
        "CI=1 pnpm test",
        "pnpm run lint:fix",
        "npm test",
        "git status",
        "./scripts/check.sh",
        "pnpm install",
        "pnpm exec vitest",
      ],
      feedback: ["abc123"],
    });
    const result = filterSuggestions([good], root);
    expect(result.dropped).toEqual([]);
    expect(result.kept).toEqual([good]);
  });

  it("drops a missing path, an absolute one and one that climbs out", () => {
    expect(reasonsOf({ evidence: [{ path: "nope.txt" }] })).toEqual([
      expect.stringContaining("does not exist"),
    ]);
    expect(reasonsOf({ evidence: [{ path: "/etc/hosts" }] })).toEqual([
      expect.stringContaining("absolute or outside"),
    ]);
    expect(reasonsOf({ evidence: [{ path: "../x" }] })).toEqual([
      expect.stringContaining("absolute or outside"),
    ]);
  });

  it("drops a commit that is not hex or not in the repository", () => {
    expect(reasonsOf({ evidence: [{ commit: "main" }] })).toEqual([
      expect.stringContaining("not 7 to 40 hex"),
    ]);
    expect(reasonsOf({ evidence: [{ commit: "deadbeef1234" }] })).toEqual([
      expect.stringContaining("not in this repository"),
    ]);
  });

  it("drops a program that is not on PATH, and keeps one inside the root", () => {
    expect(reasonsOf({ commands: ["no-such-program-xyz --fix"] })).toEqual([
      expect.stringContaining("not on PATH"),
    ]);
    expect(reasonsOf({ commands: ["FOO=1"] })).toEqual([
      expect.stringContaining("names no program"),
    ]);
    expect(reasonsOf({ commands: ["./scripts/missing.sh"] })).toEqual([
      expect.stringContaining("not on PATH"),
    ]);
    expect(reasonsOf({ commands: ["/bin/sh -c true"] })).toEqual([
      expect.stringContaining("not on PATH"),
    ]);
    expect(reasonsOf({ commands: ["./scripts/check.sh"] })).toEqual([]);
  });

  it("drops a package script that does not exist, not a manager's own command", () => {
    for (const line of [
      "npm run nope",
      "pnpm nope",
      "pnpm run nope",
      "yarn nope",
      "yarn run nope",
      "bun run nope",
    ]) {
      expect(reasonsOf({ commands: [line] })).toEqual([
        expect.stringContaining("has no script `nope`"),
      ]);
    }
    expect(reasonsOf({ commands: ["pnpm add zod", "pnpm dlx x"] })).toEqual([]);
    expect(reasonsOf({ commands: ["pnpm -r nope"] })).toEqual([]);
  });

  it("drops an entry with no package.json script when there is no package.json", () => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-filter-")));
    const { dropped } = filterSuggestions(
      [entry({ evidence: [{ path: "." }], commands: ["pnpm test"] })],
      root,
    );
    expect(dropped[0]?.reasons).toEqual([
      expect.stringContaining("has no script `test`"),
    ]);
  });

  it("gives every reason an entry has", () => {
    const reasons = reasonsOf({
      evidence: [{ path: "nope.txt" }],
      commands: ["no-such-program-xyz"],
    });
    expect(reasons).toHaveLength(2);
  });

  it("drops a repeated workflow and anything past ten, and keeps order", () => {
    const { root } = repo();
    const entries = [
      ...Array.from({ length: 10 }, (_, index) =>
        entry({ workflow: `flow-${String(index)}` }),
      ),
      entry({ workflow: "flow-3" }),
      entry({ workflow: "eleventh" }),
    ];
    const result = filterSuggestions(entries, root);
    expect(result.kept.map(item => item.workflow)).toEqual(
      entries.slice(0, 10).map(item => item["workflow"]),
    );
    expect(result.dropped).toEqual([
      {
        index: 10,
        workflow: "flow-3",
        reasons: [
          "workflow `flow-3` is suggested twice",
          "already 10 suggestions kept",
        ],
      },
      {
        index: 11,
        workflow: "eleventh",
        reasons: ["already 10 suggestions kept"],
      },
    ]);
  });

  it("tolerates malformed entries and keeps the rest", () => {
    const { root } = repo();
    const result = filterSuggestions(
      [
        null,
        "text",
        7,
        { workflow: 3 },
        { workflow: "ok" },
        entry({ caps: { budgetUsd: 0, budgetTokens: 1.5 } }),
        entry({ evidence: [] }),
        entry({ extra: true }),
        entry({ workflow: "Not A Slug" }),
        entry({ workflow: "fine" }),
      ],
      root,
    );
    expect(result.kept.map(item => item.workflow)).toEqual(["fine"]);
    expect(result.dropped.map(item => item.index)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8,
    ]);
    expect(result.dropped.map(item => item.workflow)).toEqual([
      null,
      null,
      null,
      null,
      "ok",
      "ci",
      "ci",
      "ci",
      "Not A Slug",
    ]);
  });

  it("keeps and drops nothing for an empty list", () => {
    const { root } = repo();
    expect(filterSuggestions([], root)).toEqual({ kept: [], dropped: [] });
  });

  it("runs nothing it was given", () => {
    const { root } = repo();
    const parent = path.dirname(root);
    filterSuggestions(
      [entry({ commands: ["./scripts/check.sh", "touch ../ran"] })],
      root,
    );
    expect(existsSync(path.join(parent, "ran"))).toBe(false);
  });
});
