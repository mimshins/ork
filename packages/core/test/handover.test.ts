/**
 * @file Tests for the handover note of a fresh session's earlier tasks: newest
 *   first, a task named by its description or its brief's start, the cap with
 *   the count of tasks left out, and no note with no tasks.
 */

import { describe, expect, it } from "vitest";

import {
  type EarlierTask,
  earlierTask,
  HANDOVER_MAX,
  handoverNote,
} from "../src/run/handover.ts";

const task = (name: string, summary = "done"): EarlierTask => ({
  task: name,
  status: "pass",
  summary,
});

/** The entries' headings in the note, in order. */
const headings = (note: string | undefined): string[] =>
  (note ?? "").split("\n").filter(line => line.startsWith("### "));

describe("handoverNote", () => {
  it("lists the tasks newest first, under its heading and lead-in", () => {
    const note = handoverNote([task("one"), task("two")]);
    expect(note).toMatch(
      /^## Your earlier tasks in this run\n\nThese tasks were done in an earlier session/u,
    );
    expect(headings(note)).toEqual(["### two (pass)", "### one (pass)"]);
    expect(note).not.toContain("left out");
  });

  it("leaves the oldest tasks out past the cap, and says how many", () => {
    const tasks = Array.from({ length: 6 }, (_, i) =>
      task(`t${String(i)}`, "x".repeat(2000)),
    );
    const note = String(handoverNote(tasks));
    expect(note.length).toBeLessThanOrEqual(HANDOVER_MAX);
    expect(headings(note)).toEqual([
      "### t5 (pass)",
      "### t4 (pass)",
      "### t3 (pass)",
    ]);
    expect(note).toMatch(
      /\n\n3 older tasks are left out to keep this note short\.$/u,
    );
  });

  it("clips one long summary so the newest task still fits", () => {
    const note = String(handoverNote([task("big", "y".repeat(20_000))]));
    expect(note.length).toBeLessThanOrEqual(HANDOVER_MAX);
    expect(headings(note)).toEqual(["### big (pass)"]);
  });

  it("is absent with no earlier tasks", () => {
    expect(handoverNote([])).toBeUndefined();
  });
});

describe("earlierTask", () => {
  const result = {
    ok: true,
    output: { status: "pass", summary: "  fixed  " },
  };

  it("names a task by its description, else its brief's first 80 code points", () => {
    const brief = { from: "lead", text: `Fix\n  the ${"é".repeat(100)}` };
    expect(earlierTask({ id: "fix", input: undefined, brief }, result)).toEqual(
      {
        task: `Fix the ${"é".repeat(72)}…`,
        status: "pass",
        summary: "fixed",
      },
    );
    const described = {
      id: "fix",
      input: undefined,
      brief,
      description: "Fix it",
    };
    expect(earlierTask(described, result).task).toBe("Fix it");
  });

  it("clips a long description so the note still lists the newest task", () => {
    const description = "d".repeat(20_000);
    const long = earlierTask(
      { id: "fix", input: undefined, description },
      result,
    );
    const note = String(handoverNote([long]));
    expect(headings(note)).toHaveLength(1);
    expect(note).not.toContain("left out");
  });

  it("takes the status from the outcome when the report has none", () => {
    const failed = { ok: false, output: {}, error: "no" };
    expect(earlierTask({ id: "fix", input: undefined }, failed)).toEqual({
      task: "",
      status: "fail",
      summary: "",
    });
  });
});
