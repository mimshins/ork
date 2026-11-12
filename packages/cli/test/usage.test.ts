/**
 * @file Tests for `ork usage`'s terminal output; the times it takes are tested
 *   with core's list filters.
 */

import { usageReport, type UsageRow } from "@krapht/ork-core";
import { describe, expect, it } from "vitest";

import { formatUsage, tokens } from "../src/runs/usage.ts";

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
  costUsd: 2,
  inputTokens: 1000,
  outputTokens: 500,
  cacheReadTokens: 3000,
  cacheWriteTokens: 0,
  turns: 4,
  durationMs: 1000,
  ...extra,
});

describe("ork usage", () => {
  it("says when there is nothing to show", () => {
    expect(formatUsage(usageReport([]), "this project")).toEqual([
      "No Claude sessions in this project.",
    ]);
  });

  it("shows the total, the overview's sections and the estimate's caveat", () => {
    const text = formatUsage(usageReport([row()]), "this project").join("\n");
    expect(text).toContain("$2.0000");
    expect(text).toContain(
      "1 run · 1 session · 4 turns · 4.0k prompt / 500 out (1.5k counted) · 75% from cache",
    );
    expect(text).toContain("By day");
    expect(text).toContain("By workflow");
    expect(text).toContain("By model");
    expect(text).toContain("Costliest nodes");
    expect(text).toContain("ship/build");
    expect(text).toContain("Claude Code's own estimates");
  });

  it("shows the CPU seconds of each node's tool commands by node", () => {
    const cpu = {
      runId: "r1",
      seq: 2,
      at: "2026-11-03T10:00:00.000Z",
      project: "/p",
      workflow: "ship",
      node: "check",
      userMs: 30_000,
      systemMs: 4500,
    };
    const text = formatUsage(
      usageReport([row()], [cpu]),
      "this project",
      "node",
    ).join("\n");
    expect(text).toContain("TOOL CPU");
    expect(text).toMatch(/ship\/check .*34\.5 s/u);
  });

  it("keeps the costliest rows and the latest days in the overview", () => {
    const rows = Array.from({ length: 12 }, (_, index) =>
      row({
        seq: index,
        workflow: `w${String(index)}`,
        costUsd: index + 1,
        at: `2026-10-${String(index + 10)}T10:00:00.000Z`,
      }),
    );
    const text = formatUsage(usageReport(rows), "this project").join("\n");
    expect(text).toContain("w11");
    expect(text).not.toContain("w0 ");
    expect(text).toContain("and 2 more (--by workflow)");
    expect(text).toContain("2026-10-21");
    expect(text).not.toContain("2026-10-10");
  });

  it("shows one section with --by, and hints when there are any", () => {
    const text = formatUsage(
      usageReport([row({ round: 3 })]),
      "this project",
      "model",
    ).join("\n");
    expect(text).toContain("By model");
    expect(text).not.toContain("By workflow");
    expect(text).toContain("Worth a look");
    expect(text).toContain("loop rounds");
  });

  it("shortens large counts", () => {
    expect(tokens(950)).toBe("950");
    expect(tokens(12_300)).toBe("12.3k");
    expect(tokens(4_500_000)).toBe("4.5M");
  });
});
