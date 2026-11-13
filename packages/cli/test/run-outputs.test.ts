/**
 * @file A finished run's declared outputs in the summary `ork run`, `ork logs`
 *   and `ork attach` print: one per key, long values cut with a pointer, and
 *   the `--json` stream left as it was.
 */

import type { RunResult, StoredEvent } from "@krapht/ork-core";
import { describe, expect, it } from "vitest";

import { formatRunResult } from "../src/run/format-result.ts";
import { createLogPrinter } from "../src/runs/logs.ts";
import type { Term } from "../src/term/mode.ts";

const plainTerm: Term = { rich: false, width: 80, rows: 24 };

const resultWith = (
  extra: Partial<RunResult>,
  status: RunResult["status"] = "succeeded",
): RunResult => ({
  runId: "r1",
  status,
  costUsd: 0.5,
  nodes: [],
  reasons: [],
  worktrees: [],
  ...extra,
});

const ISSUES = {
  integrated: "#1",
  leftOut:
    "#2: its builder failed: could not build it\n#3: the review did not pass it: no tests",
  url: "https://github.com/o/r/pull/7",
};

describe("the run summary's outputs", () => {
  it("names each left-out issue, why, and the pull request", () => {
    const lines = formatRunResult(
      resultWith({ outputs: ISSUES }),
      plainTerm,
    ).slice(2);
    expect(lines).toEqual([
      "  integrated: #1",
      "  leftOut:",
      "    #2: its builder failed: could not build it",
      "    #3: the review did not pass it: no tests",
      "  url: https://github.com/o/r/pull/7",
    ]);
  });

  it("prints what a failed run has", () => {
    const lines = formatRunResult(
      resultWith(
        { outputs: { url: "u" }, reasons: ["node pr failed"] },
        "failed",
      ),
      plainTerm,
    );
    expect(lines).toContain("  url: u");
  });

  it("changes nothing when no output is declared", () => {
    expect(formatRunResult(resultWith({}), plainTerm)).toHaveLength(2);
    expect(
      formatRunResult(resultWith({ outputs: {} }), plainTerm),
    ).toHaveLength(2);
  });

  it("cuts a long value and points at the full one", () => {
    const long = Array.from({ length: 30 }, (_, i) => `line ${String(i)}`);
    const lines = formatRunResult(
      resultWith({ outputs: { doc: long.join("\n") } }),
      plainTerm,
    );
    expect(lines).toContain("    line 19");
    expect(lines).not.toContain("    line 20");
    expect(lines.at(-1)).toBe("    … cut; full value: ork logs r1 --json");
  });

  it("strips escape sequences a session wrote", () => {
    const lines = formatRunResult(
      resultWith({ outputs: { note: "\u001B[31mred\u001B[0m" } }),
      plainTerm,
    );
    expect(lines).toContain("  note: red");
  });

  it("says an empty value is empty", () => {
    expect(
      formatRunResult(resultWith({ outputs: { leftOut: "" } }), plainTerm),
    ).toContain("  leftOut: (empty)");
  });
});

const finished: StoredEvent = {
  runId: "r1",
  seq: 1,
  at: "2026-11-13T10:00:00.000Z",
  event: {
    type: "run.finished",
    result: resultWith({ outputs: { url: "u" } }),
  },
};

describe("ork logs and the --json stream", () => {
  it("prints the outputs in the transcript", () => {
    const lines = createLogPrinter({ json: false })(finished);
    expect(lines.join("\n")).toContain("url: u");
  });

  it("leaves --json as the stored event", () => {
    expect(createLogPrinter({ json: true })(finished)).toEqual([
      JSON.stringify(finished),
    ]);
  });
});
