/**
 * @file Tests for the CLI's side of token budgets (RFC-015): `ork usage`'s
 *   Limits line and partial totals, `ork ps` and the run summary marking a
 *   partial dollar total.
 */

import {
  type RunRecord,
  type RunResult,
  usageReport,
  type UsageRow,
} from "@krapht/ork-core";
import { describe, expect, it } from "vitest";

import { formatRunResult } from "../src/run/format-result.ts";
import { formatRuns } from "../src/runs/format.ts";
import { formatLimits, formatUsage } from "../src/runs/usage.ts";
import type { Term } from "../src/term/mode.ts";

const plainTerm: Term = { rich: false, width: 80, rows: 24 };

const row = (extra: Partial<UsageRow> = {}): UsageRow => ({
  runId: "r1",
  seq: 1,
  at: "2026-11-03T10:00:00.000Z",
  project: "/p",
  workflow: "ship",
  node: "build",
  model: "sonnet",
  kind: "node",
  round: 1,
  failed: false,
  costUsd: 1.2,
  inputTokens: 1000,
  outputTokens: 500,
  cacheReadTokens: 3000,
  cacheWriteTokens: 0,
  turns: 4,
  durationMs: 1000,
  ...extra,
});

const report = (partial: boolean) =>
  formatUsage(
    {
      ...usageReport([row()]),
      totals: {
        ...usageReport([row()]).totals,
        partial,
        tokens: 1500,
      },
    },
    "this project",
    undefined,
    plainTerm,
  )[0];

describe("ork usage and tokens", () => {
  it("shows dayTokens beside dayUsd in the Limits line", () => {
    const lines = formatLimits(
      {
        problems: [],
        caps: [
          {
            window: "day",
            capUsd: 5,
            spentUsd: 1,
            leftUsd: 4,
            resetsAt: "2026-11-04T00:00:00.000Z",
          },
        ],
        tokenCaps: [
          {
            window: "day",
            capTokens: 2_000_000,
            spentTokens: 1_200_000,
            leftTokens: 800_000,
            resetsAt: "2026-11-04T00:00:00.000Z",
          },
        ],
        plan: [],
      },
      plainTerm,
    );
    expect(lines[1]).toContain("all projects, this day: $1.00 of $5.00");
    expect(lines[2]).toContain(
      "all projects, this day: 1.2M of 2.0M tokens, resets",
    );
  });

  it("prints a Limits line for a token cap alone", () => {
    expect(
      formatLimits(
        {
          problems: [],
          caps: [],
          tokenCaps: [
            {
              window: "day",
              capTokens: 50_000,
              spentTokens: 50_000,
              leftTokens: 0,
              resetsAt: "2026-11-04T00:00:00.000Z",
            },
          ],
          plan: [],
        },
        plainTerm,
      ).join("\n"),
    ).toContain("this day: 50.0k of 50.0k tokens");
  });

  it("marks a partial dollar total and shows tokens beside it", () => {
    expect(report(true)).toContain("$1.2000 (partial) · 1.5k tokens in this");
    expect(report(false)).not.toContain("partial");
  });
});

const runRecord = (extra: Partial<RunRecord>): RunRecord => ({
  id: "run00001",
  workflow: "w",
  file: "/w",
  project: "/p",
  startedAt: "2026-11-03T10:00:00.000Z",
  status: "succeeded",
  pid: 1,
  processStart: "t",
  depth: 0,
  costUsd: 0.5,
  ...extra,
});

describe("ork ps and the run summary with tokens", () => {
  it("marks a partial total in the ps table", () => {
    const [, partial, whole] = formatRuns(
      [
        runRecord({ id: "partial1", partial: true, tokens: 12_300 }),
        runRecord({ id: "whole001", tokens: 12_300 }),
      ],
      false,
      Date.parse("2026-11-03T10:05:00.000Z"),
      run => run.status,
      plainTerm,
    );
    expect(partial).toContain("$0.5000 (partial) · 12.3k tokens");
    expect(whole).not.toContain("partial");
  });

  it("marks a partial total in the run summary", () => {
    const result: RunResult = {
      runId: "r1",
      status: "succeeded",
      costUsd: 0.5,
      tokens: 3000,
      partial: true,
      nodes: [],
      reasons: [],
      worktrees: [],
    };
    expect(formatRunResult(result, plainTerm)[1]).toContain(
      "· $0.5000 (partial) · 3.0k tokens ·",
    );
  });
});
