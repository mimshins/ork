/**
 * @file Tests for how the Decisions panel says a decision ended, and who
 *   answered: a person, or the leader that took its child's question first
 *   (ADR-063), and a question a leader passed on.
 */

import type { DecisionRecord } from "@krapht/ork-server/client";
import { describe, expect, it } from "vitest";

import {
  endingOf,
  openLine,
  suggestionsOf,
} from "../../src/panels/decisions-model.ts";

const answered = (extra: Partial<DecisionRecord>): DecisionRecord => ({
  id: "r1-2",
  runId: "r1",
  node: "work",
  kind: "question",
  question: "Which approach?",
  options: [{ id: "a", label: "Keep the API" }, { id: "b" }],
  openedAt: "2026-11-08T10:00:00.000Z",
  status: "answered",
  answer: "a",
  ...extra,
});

describe("how a decision ended", () => {
  it("names the leader that answered its child's question", () => {
    expect(endingOf(answered({ answeredBy: "owner", owner: "lead" }))).toBe(
      "Answered Keep the API by `lead`, its owner.",
    );
  });

  it("says a leader passed it on before a person answered", () => {
    expect(endingOf(answered({ answeredBy: "ui", owner: "lead" }))).toBe(
      "Answered Keep the API in `ork ui`, after `lead` passed it on.",
    );
  });

  it("says who answered when no leader took it", () => {
    expect(endingOf(answered({ answeredBy: "decide" }))).toBe(
      "Answered Keep the API with `ork decide`.",
    );
  });
});

const open = (id: string, runId: string): DecisionRecord =>
  answered({ id, runId, status: "open" });

const WORKFLOWS: Record<string, string> = {
  r1: "feature",
  r2: "feature",
  r3: "review",
};
const workflowOf = (run: string): string | undefined => WORKFLOWS[run];
const LIST = [
  open("d1", "r1"),
  open("d2", "r1"),
  open("d3", "r2"),
  open("d4", "r3"),
];

describe("the filter bar's help", () => {
  it("suggests each workflow once, and each run with its workflow", () => {
    const { workflow, run } = suggestionsOf(LIST, workflowOf);
    expect(workflow).toEqual([
      { value: "feature", label: "feature" },
      { value: "review", label: "review" },
    ]);
    expect(run).toEqual([
      { value: "r1", label: "r1 · feature" },
      { value: "r2", label: "r2 · feature" },
      { value: "r3", label: "r3 · review" },
    ]);
  });

  it("names a run whose workflow is not known by its id alone", () => {
    expect(suggestionsOf(LIST, run => WORKFLOWS[`${run}-none`]).run[0]).toEqual(
      {
        value: "r1",
        label: "r1",
      },
    );
  });

  it("says how many are open with no filter", () => {
    expect(openLine(4)).toBe("4 open decisions.");
    expect(openLine(1)).toBe("1 open decision.");
  });
});
