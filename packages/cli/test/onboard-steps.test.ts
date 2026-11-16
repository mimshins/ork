/**
 * @file Tests for the pieces of `ork onboard`'s flow that need no run: which
 *   mode a project is in, the questions and the `answers` text they make,
 *   reading the proposer's result and showing the suggestions, and what is said
 *   when the write run's branch is kept, discarded or never finished.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { openStore, type ProjectPlace, type RunResult } from "@krapht/ork-core";
import { describe, expect, it, vi } from "vitest";

import { modeLine, modeOf } from "../src/onboard/mode.ts";
import { proposedOf, suggestionLines } from "../src/onboard/pick.ts";
import { answersText, questionsFor } from "../src/onboard/questions.ts";
import { finishProblems, settleWrite } from "../src/onboard/runs.ts";

describe("modeOf", () => {
  const flags = { review: false, fresh: false };

  it("is a first visit for the starter alone, or workflows with no run", () => {
    expect(modeOf({ workflows: ["hello"], runs: 3 }, flags)).toBe("first");
    expect(modeOf({ workflows: ["build"], runs: 0 }, flags)).toBe("first");
    expect(modeOf({ workflows: [], runs: 0 }, flags)).toBe("first");
  });

  it("is a review with a workflow other than the starter and a run", () => {
    const held = { workflows: ["hello", "build"], runs: 41 };
    expect(modeOf(held, flags)).toBe("review");
    expect(modeLine("review", held)).toBe(
      "Mode: review (2 workflows, 41 runs)",
    );
  });

  it("lets --review and --fresh override", () => {
    const empty = { workflows: [], runs: 0 };
    const full = { workflows: ["build"], runs: 2 };
    expect(modeOf(empty, { review: true, fresh: false })).toBe("review");
    expect(modeOf(full, { review: false, fresh: true })).toBe("first");
    expect(modeLine("first", empty)).toBe("Mode: first visit");
  });
});

describe("the questions", () => {
  it("swaps the first question on a review", () => {
    const first = questionsFor("first");
    const review = questionsFor("review");
    expect(first).toHaveLength(3);
    expect(first[0]).toContain("slows you down");
    expect(review[0]).toContain("went wrong lately");
    expect(review.slice(1)).toEqual(first.slice(1));
  });

  it("makes Q and A lines, keeps an empty answer as (no answer), cuts a long one", () => {
    const text = answersText([
      { question: "One?", answer: "tests\u001B[31m are slow" },
      { question: "Two?", answer: "" },
      { question: "Three?", answer: "x".repeat(5000) },
    ]);
    const blocks = text.split("\n\n");
    expect(blocks[0]).toBe("Q: One?\nA: tests [31m are slow");
    expect(blocks[1]).toBe("Q: Two?\nA: (no answer)");
    expect(blocks[2]?.length).toBeLessThan(2100);
  });
});

const suggestion = {
  workflow: "triage",
  why: "Issues pile up.",
  decidedBy: "you, at the gate",
  caps: { budgetUsd: 2, budgetTokens: 400000 },
  evidence: [{ path: "README.md" }, { commit: "abcdef1234567890" }],
  feedback: ["fb1"],
};

const result = (
  nodes: { id: string; ok: boolean; output: Record<string, unknown> }[],
  status: RunResult["status"] = "succeeded",
): RunResult => ({
  runId: "run-1",
  status,
  costUsd: 0,
  nodes: nodes.map(n => ({ ...n, runs: 1, costUsd: 0 })),
  reasons: ["it stopped"],
  worktrees: [],
});

describe("proposedOf", () => {
  it("reads kept and dropped from the filter node's json", () => {
    const proposed = proposedOf(
      result([
        {
          id: "filter",
          ok: true,
          output: {
            json: {
              kept: [suggestion, { workflow: "Not A Slug" }],
              dropped: [{ index: 1, workflow: "x", reasons: ["no such file"] }],
            },
          },
        },
      ]),
    );
    expect(proposed.kept.map(s => s.workflow)).toEqual(["triage"]);
    expect(proposed.dropped).toEqual([
      { index: 1, workflow: "x", reasons: ["no such file"] },
    ]);
  });

  it("falls back to stdout, and to nothing when it is not JSON", () => {
    const fromStdout = proposedOf(
      result([
        {
          id: "filter",
          ok: true,
          output: { stdout: JSON.stringify({ kept: [suggestion] }) },
        },
      ]),
    );
    expect(fromStdout.kept).toHaveLength(1);
    const junk = proposedOf(
      result([{ id: "filter", ok: true, output: { stdout: "nope" } }]),
    );
    expect(junk).toEqual({ kept: [], dropped: [] });
  });

  it("shows a suggestion's workflow, why, who decides, caps and evidence", () => {
    const text = suggestionLines(suggestion, 1).join("\n");
    for (const part of [
      "triage",
      "Issues pile up.",
      "you, at the gate",
      "$2",
      "400.0k tokens",
      "README.md",
      "commit abcdef123456",
    ]) {
      expect(text).toContain(part);
    }
  });
});

const place: ProjectPlace = { root: "/p", mode: "in-repo", dir: "/p/.ork" };

const writeOptions = (ahead: number) =>
  ({
    store: openStore(
      path.join(mkdtempSync(path.join(tmpdir(), "ork-onb-")), "state.db"),
    ),
    place,
    driver: "claude-code",
    ahead: () => Promise.resolve(ahead),
    out: vi.fn<(line: string) => void>(),
    err: vi.fn<(line: string) => void>(),
    runtime: () => Promise.reject(new Error("no runtime")),
  }) satisfies Parameters<typeof settleWrite>[0];

const written = (choice: string) =>
  result([
    {
      id: "write",
      ok: true,
      output: { branch: "ork/onboard-1", summary: "wrote triage" },
    },
    { id: "keep", ok: true, output: { choice } },
  ]);

describe("settleWrite", () => {
  it("keeps the branch, says Ork never merges, and lists the cited items unresolved", async () => {
    const settled = await settleWrite(
      writeOptions(1),
      written("keep"),
      ["fb1", "fb2"],
      true,
    );
    const text = settled.lines.join("\n");
    expect(settled.code).toBe(0);
    expect(text).toContain("ork/onboard-1");
    expect(text).toContain("Ork never merges");
    expect(text).toContain("fb1, fb2");
    expect(text).toContain("not resolved");
    expect(text).toContain(".gitignore");
  });

  it("names no feedback and no .gitignore when there are none", async () => {
    const settled = await settleWrite(
      writeOptions(2),
      written("keep"),
      [],
      false,
    );
    const text = settled.lines.join("\n");
    expect(text).not.toContain("Feedback");
    expect(text).not.toContain(".gitignore");
  });

  it("reports out of rounds with the run id and finish's last problems", async () => {
    const out = result(
      [
        { id: "write", ok: true, output: { branch: "b", summary: "" } },
        {
          id: "finish",
          ok: false,
          output: { stdout: "a.ork.yaml: no budgetUsd\n\nb.ork.yaml: bad" },
        },
      ],
      "failed",
    );
    expect(finishProblems(out)).toEqual([
      "a.ork.yaml: no budgetUsd",
      "b.ork.yaml: bad",
    ]);
    const settled = await settleWrite(writeOptions(0), out, [], false);
    const text = settled.lines.join("\n");
    expect(settled.code).toBe(1);
    expect(text).toContain("run run-1");
    expect(text).toContain("ork resume run-1");
    expect(text).toContain("a.ork.yaml: no budgetUsd");
  });
});
