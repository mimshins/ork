/**
 * @file Rendering tests for the listing and check commands on the terminal kit:
 *   the shared table (alignment, chips, cut to the width), and `ps`, `usage`,
 *   `feedback`, `projects`, `watch`, `doctor` and `validate` in rich mode
 *   (chips, cut and wrapped lines) and plain mode (today's lines, no escape
 *   codes).
 */

import { stripVTControlCharacters } from "node:util";

import {
  type FeedbackItem,
  type ProjectRecord,
  type RunEvent,
  type RunRecord,
  usageReport,
} from "@krapht/ork-core";
import { describe, expect, it } from "vitest";

import {
  formatCheck,
  formatFeedbackItems,
  formatProjects,
  formatReport,
  formatRuns,
  listedStatus,
} from "../src/index.ts";
import { formatLimits, formatUsage } from "../src/runs/usage.ts";
import { statusChip } from "../src/term/chips.ts";
import { widthOf } from "../src/term/layout.ts";
import type { Term } from "../src/term/mode.ts";
import { type Cell, header, table } from "../src/term/table.ts";
import { brokenLines, statusLines } from "../src/watch/report.ts";

const ESC = "\u001B";
const rich = (width: number): Term => ({ rich: true, width, rows: 24 });
const plainTerm: Term = { rich: false, width: 30, rows: 24 };
const bare = (lines: readonly string[]): string[] =>
  lines.map(line => stripVTControlCharacters(line));

const statusOf = (r: RunRecord): string => r.status;
const statusWith =
  (events: RunEvent[]) =>
  (r: RunRecord): string =>
    listedStatus(r, events);

const project = (id: string, root: string): ProjectRecord => ({
  id,
  mode: "attached",
  root,
  dir: `/home/me/.ork/projects/${id}`,
  registeredAt: "2026-11-01T00:00:00.000Z",
});

const NOW = Date.parse("2026-11-10T12:00:00.000Z");

const run = (extra: Partial<RunRecord>): RunRecord => ({
  id: "509da722",
  workflow: "a-rather-long-workflow-name",
  file: "/p/w.ork.yaml",
  project: "/home/me/project",
  status: "succeeded",
  pid: 1,
  startedAt: "2026-11-10T11:00:00.000Z",
  finishedAt: "2026-11-10T11:05:00.000Z",
  costUsd: 1.5,
  depth: 0,
  ...extra,
});

describe("table", () => {
  const rows: Cell[][] = [
    [header("NAME"), header("N")],
    [{ text: "alpha-long-name" }, { text: "1" }],
    [{ text: "b" }, { text: "22" }],
  ];

  it("aligns columns, pads all but the last left one, plain", () => {
    expect(table(plainTerm, [{}, { align: "right" }], rows)).toEqual([
      "NAME              N",
      "alpha-long-name   1",
      "b                22",
    ]);
    expect(table(plainTerm, [{}, {}], rows, "  ")[2]).toBe(
      "  b                22",
    );
  });

  it("cuts a flexible column to the width when rich, never plain", () => {
    const cols = [{ flex: true }, { align: "right" } as const];
    expect(bare(table(rich(12), cols, rows))[1]).toBe("alpha-l…   1");
    expect(table({ ...plainTerm, width: 12 }, cols, rows)[1]).toBe(
      "alpha-long-name   1",
    );
  });

  it("draws a chip with its words rich and the plain text plain", () => {
    const cell: Cell = { text: "running", chip: statusChip("running") };
    expect(bare(table(rich(40), [{}, {}], [[cell, { text: "x" }]]))).toEqual([
      " RUN   x",
    ]);
    expect(table(rich(40), [{}], [[cell]])[0]).toContain(ESC);
    expect(table(plainTerm, [{}], [[cell]])).toEqual(["running"]);
  });
});

describe("ork ps", () => {
  const runs = [
    run({}),
    run({ id: "b1", status: "budget_exhausted", parent: "509da722" }),
  ];

  it("reads a running run with a command waiting for a slot as waiting", () => {
    const live = run({ status: "running", pid: process.pid });
    const waiting: RunEvent[] = [
      { type: "slot.waiting", id: "check", holders: ["a1/build"] },
    ];
    const taken: RunEvent[] = [...waiting, { type: "slot.taken", id: "check" }];
    expect(
      formatRuns([live], false, NOW, statusWith(waiting), plainTerm).join("\n"),
    ).toContain("waiting for slot");
    expect(
      formatRuns([live], false, NOW, statusWith(taken), plainTerm).join("\n"),
    ).not.toContain("waiting for slot");
  });

  it("reads a running run with a node waiting for a lock as waiting for it", () => {
    const live = run({ status: "running", pid: process.pid });
    const waiting: RunEvent[] = [
      {
        type: "lock.waiting",
        id: "push",
        lock: "branch:main",
        holders: ["r1/push"],
      },
    ];
    const taken: RunEvent[] = [
      ...waiting,
      { type: "lock.taken", id: "push", lock: "branch:main" },
    ];
    expect(
      formatRuns([live], false, NOW, statusWith(waiting), plainTerm).join("\n"),
    ).toContain("waiting for branch:main, held by r1/push");
    expect(
      formatRuns([live], false, NOW, statusWith(taken), plainTerm).join("\n"),
    ).not.toContain("waiting for");
  });

  it("keeps today's table plain, with no escape codes", () => {
    const lines = formatRuns(runs, false, NOW, statusOf, plainTerm);
    expect(lines.join("\n")).not.toContain(ESC);
    expect(lines[0]).toBe(
      "RUN       WORKFLOW                     STATUS            STARTED                        COST",
    );
    expect(lines[1]).toContain("succeeded");
  });

  it("shows chips for status and cuts the workflow to the screen when rich", () => {
    const lines = formatRuns(runs, false, NOW, statusOf, rich(80));
    expect(lines.join("\n")).toContain(ESC);
    const text = bare(lines);
    expect(text[1]).toContain(" OK ");
    expect(text[2]).toContain(" BUDGET EXHAUSTED ");
    expect(text[1]).toContain("…");
    expect(Math.max(...text.map(line => widthOf(line)))).toBeLessThanOrEqual(
      80,
    );
  });

  it("adds the project as a last column", () => {
    expect(bare(formatRuns(runs, true, NOW, statusOf, rich(120)))[0]).toMatch(
      /PROJECT$/u,
    );
  });
});

describe("ork usage", () => {
  const limits = {
    problems: ["the limit file is unreadable"],
    caps: [],
    plan: [],
  };

  it("marks a limit problem with a WARN chip when rich, yellow text plain", () => {
    expect(bare(formatLimits(limits, rich(60)))[1]).toBe(
      "   WARN  the limit file is unreadable",
    );
    expect(formatLimits(limits, plainTerm)[1]).toBe(
      "  the limit file is unreadable",
    );
  });

  it("says nothing styled when there is nothing, plain", () => {
    expect(formatUsage(usageReport([]), "here", undefined, plainTerm)).toEqual([
      "No Claude sessions in here.",
    ]);
  });
});

describe("ork feedback list", () => {
  const item: FeedbackItem = {
    id: "ab12",
    merged: [],
    status: "dismissed",
    title: "A very long title that would run past the right edge",
    target: "workflow",
    kind: "context-gap",
    severity: "high",
    sources: [],
    count: 3,
    firstSeen: "2026-11-09T12:00:00.000Z",
    lastSeen: "2026-11-10T11:00:00.000Z",
    runs: [],
    workflows: [],
    models: [],
  };

  it("cuts the title to the screen and chips the status when rich", () => {
    const [line = ""] = bare(formatFeedbackItems([item], NOW, rich(70)));
    expect(line).toContain(" DISMISSED ");
    expect(line).toContain("…");
    expect(widthOf(line)).toBeLessThanOrEqual(70);
  });

  it("prints today's line plain", () => {
    expect(formatFeedbackItems([item], NOW, plainTerm)).toEqual([
      "ab12   3× workflow/context-gap  A very long title that would run past the right edge [dismissed] · 1h ago",
    ]);
  });
});

describe("ork projects", () => {
  const all = [
    project("a", "/no/such/place/for/the/long/path/of/a/project"),
    project("longer", "/no/such/b"),
  ];

  it("aligns ids, chips the mode and a missing clone, and cuts the root when rich", () => {
    const text = bare(formatProjects(all, rich(40)));
    expect(text[0]).toMatch(/^a +  ATTACHED /u);
    expect(text[0]).toContain("…");
    expect(text[0]).toContain(" MISSING ");
    expect(text[2]).toMatch(/^longer {2} ATTACHED {3}\/no\/such\/b/u);
    expect(Math.max(...text.map(line => widthOf(line)))).toBeLessThanOrEqual(
      42,
    );
  });

  it("prints today's lines plain", () => {
    expect(formatProjects(all, plainTerm)[0]).toBe(
      "a  attached  /no/such/place/for/the/long/path/of/a/project (missing)",
    );
  });
});

describe("ork watch --status", () => {
  const report = {
    broken: [{ project: "p", file: "t.ork.yaml", message: "bad" }],
    triggers: [
      {
        project: "p",
        trigger: "t",
        run: "x",
        every: "1m",
        standing: "new" as const,
        problems: ["nope"],
        warnings: [],
      },
    ],
  };

  it("uses chips for standing and failures when rich", () => {
    const text = bare(statusLines(report, rich(60)));
    expect(text).toContain(" FAIL  t.ork.yaml: bad");
    expect(text).toContain("   OFF  new, not accepted");
    expect(text).toContain("   FAIL  nope");
  });

  it("keeps the marks and words plain", () => {
    const text = statusLines(report, plainTerm);
    expect(text).toContain("✗ t.ork.yaml: bad");
    expect(text).toContain("  off: new, not accepted");
    expect(brokenLines(report.broken, plainTerm).join()).not.toContain(ESC);
  });
});

describe("ork doctor", () => {
  const warn = {
    name: "gh",
    status: "warn" as const,
    detail: "not logged in, so pull requests cannot be opened from here",
    hint: "Run `gh auth login`, then check again with ork doctor.",
  };

  it("lines chips and names up, wraps details and dims the hint when rich", () => {
    const lines = formatCheck(warn, rich(50));
    expect(lines.join("\n")).toContain(ESC);
    expect(bare(lines)).toEqual([
      " WARN  gh                   not logged in, so pull",
      "                            requests cannot be",
      "                            opened from here",
      "  Run `gh auth login`, then check again with ork",
      "  doctor.",
    ]);
  });

  it.each([
    ["ok", " OK   "],
    ["fail", " FAIL "],
    ["skip", " SKIP "],
  ] as const)("chips a %s check", (status, chipText) => {
    expect(
      bare(formatCheck({ name: "n", status, detail: "d" }, rich(50)))[0],
    ).toBe(`${chipText} n                    d`);
  });

  it("prints the mark and hint plain", () => {
    expect(formatCheck(warn, plainTerm)).toEqual([
      "! gh                   not logged in, so pull requests cannot be opened from here",
      "  Run `gh auth login`, then check again with ork doctor.",
    ]);
  });
});

describe("ork validate", () => {
  const report = {
    file: "x.ork.yaml",
    diagnostics: [
      {
        severity: "error" as const,
        code: "ref.input",
        path: ["nodes", "a"],
        message: "`inputs.nope` reads an input the workflow does not declare",
        line: 6,
        column: 13,
      },
    ],
  };

  it("chips the diagnostic and the verdict, and wraps the message when rich", () => {
    expect(bare(formatReport(report, false, rich(40)))).toEqual([
      " ERROR  x.ork.yaml:6:13",
      "  `inputs.nope` reads an input the",
      "  workflow does not declare",
      "  (ref.input)",
      " FAIL  x.ork.yaml (1 error, 0 warnings)",
    ]);
  });

  it("prints the compiler-style lines plain", () => {
    expect(formatReport(report, false, plainTerm)).toEqual([
      "x.ork.yaml:6:13 error `inputs.nope` reads an input the workflow does not declare (ref.input)",
      "✗ x.ork.yaml (1 error, 0 warnings)",
    ]);
  });
});
