/**
 * @file Tests what a public benchmark may hold: allowed files and fields, the
 *   scan for private data, the brief cut before a plan, the results table, and
 *   the check over a folder.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { checkPublic } from "../public-check.ts";
import { resultsOf, resultsTable, withTable } from "../public-report.ts";
import { allowedFile, findings, publicSummary } from "../public.ts";
import { publicBrief } from "../publish.ts";

describe("what a benchmark may hold", () => {
  it.each([
    ["README.md", true],
    ["results.json", true],
    ["node-mcp/README.md", true],
    ["node-mcp/usage.csv", true],
    ["node-mcp/inputs/brief.md", true],
    ["node-mcp/inputs/workflow/feature.ork.yaml", true],
    ["node-mcp/inputs/workflow/agents/engine.md", true],
    ["node-mcp/spec.md", false],
    ["node-mcp/inputs/workflow/.DS_Store", false],
    ["node-mcp/inputs/events.jsonl", false],
    ["Node MCP/README.md", false],
  ])("%s: %s", (file, allowed) => {
    expect(allowedFile(file)).toBe(allowed);
  });

  it("keeps only the published summary fields", () => {
    expect(
      publicSummary({ run: "r1", cost_usd: 2, project: "x", file: "y" }),
    ).toEqual({ run: "r1", cost_usd: 2 });
  });
});

describe("the scan for private data", () => {
  it.each([
    ["a home path", "cwd /Users/someone/code"],
    ["a home path", "in /home/someone/x"],
    ["a temp path", "at /private/var/folders/ab/T/x"],
    ["an email", "mail me@example.org"],
    ["an Anthropic key", "sk-ant-api03-abcdefghijkl"],
    ["a GitHub token", "ghp_abcdefghijklmnopqrstuvwx"],
    ["an AWS key", "AKIAABCDEFGHIJKLMNOP"],
    ["a private key", "-----BEGIN OPENSSH PRIVATE KEY-----"],
  ])("finds %s", (what, text) => {
    expect(findings(text, [])).toContain(what);
  });

  it("allows the repository's own URLs, and finds local names", () => {
    const text =
      "[`abc`](https://github.com/someone/ork/commit/abc) and raw.githubusercontent.com/someone/ork/main";
    expect(findings(text, ["someone"])).toEqual([]);
    expect(findings("by someone", ["someone"])).toEqual([
      "this machine's user name, home or git email",
    ]);
  });
});

describe("a public brief", () => {
  it("keeps a brief with no plan in it", () => {
    expect(publicBrief("## brief\n\nPlan and build RFC-014\n")).toBe(
      "## brief\n\nPlan and build RFC-014\n",
    );
  });

  it("cuts an embedded plan, and says so", () => {
    expect(publicBrief("Build tasks 1 to 13.\n\n# The plan\n\nSecret\n")).toBe(
      "Build tasks 1 to 13.\n\nThe rest of this input was the approved plan, which is not published.\n",
    );
  });

  it("says when the brief was only the plan", () => {
    expect(publicBrief("# The plan\n\nSecret\n")).not.toContain("Secret");
  });
});

const CONTROL = {
  rate: {
    sessions: 4,
    windows: 10,
    commits: 20,
    lines: 30_000,
    usd_per_kline: [3, 4.5, 7],
    min_per_kline: [9, 14, 36],
  },
  estimates: [
    {
      name: "b",
      lines: 2000,
      manual_usd: [6, 9, 14],
      manual_working_min: [18, 28, 72],
    },
  ],
};

const summary = (name: string, started: string) => ({
  benchmark: name,
  run: `${name}0000`,
  ork: { versions: ["1.0.0"] },
  status: "succeeded",
  started,
  cost_usd: 5,
  minutes: { working: 20, waiting_on_maintainer: 1, wall: 21 },
});

describe("the results", () => {
  it("lists benchmarks by date, with the manual estimate where there is one", () => {
    const results = resultsOf(
      [summary("b", "2026-11-09"), summary("a", "2026-11-08")],
      CONTROL,
    );
    expect(results.benchmarks.map(b => [b.benchmark, b.manual_usd])).toEqual([
      ["a", null],
      ["b", [6, 9, 14]],
    ]);
    expect(results.manual_rate).toEqual({
      sessions: 4,
      windows: 10,
      commits: 20,
      changed_lines: 30_000,
      usd_per_1000_lines: [3, 4.5, 7],
      working_min_per_1000_lines: [9, 14, 36],
    });
    const table = resultsTable(results);
    expect(table).toContain(
      "| [b](./b/README.md) | 1.0.0 | succeeded | 2,000 | $5.00 | $9.00 ($6.00–$14.00) | 20 | 28 (18–72) |",
    );
    expect(table).toContain(
      "| [a](./a/README.md) | 1.0.0 | succeeded | — | $5.00 | — | 20 | — |",
    );
  });

  it("replaces only what is between the markers", () => {
    const readme =
      "top\n<!-- results:start -->\nold\n<!-- results:end -->\nend\n";
    expect(withTable(readme, "new")).toBe(
      "top\n<!-- results:start -->\n\nnew\n\n<!-- results:end -->\nend\n",
    );
  });
});

describe("the check over benchmarks/", () => {
  it("finds a stray file, an unpublished field and a path", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ork-public-"));
    mkdirSync(path.join(root, "benchmarks", "b"), { recursive: true });
    writeFileSync(path.join(root, "benchmarks", "README.md"), "Fine.\n");
    writeFileSync(path.join(root, "benchmarks", "b", "spec.md"), "plan\n");
    writeFileSync(
      path.join(root, "benchmarks", "b", "summary.json"),
      JSON.stringify({ run: "r", project: "/Users/someone/ork" }),
    );
    expect(checkPublic(root, []).toSorted()).toEqual([
      "b/spec.md: not a file a benchmark may hold",
      "b/summary.json: `project` is not a published field",
      "b/summary.json: holds a home path",
    ]);
  });
});
