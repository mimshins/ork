/**
 * @file Tests for how the Decisions panel says a decision ended, and who
 *   answered: a person, or the leader that took its child's question first
 *   (ADR-063), and a question a leader passed on.
 */

import type { DecisionRecord } from "@krapht/ork-server/client";
import { describe, expect, it } from "vitest";

import {
  countLine,
  endingOf,
  filterView,
  listCommand,
  presentOnly,
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

describe("the filter", () => {
  it("counts each workflow and run, the runs only of the chosen workflow", () => {
    const view = filterView(LIST, { workflow: "feature" }, workflowOf);
    expect(view.workflows.map(({ label }) => label)).toEqual([
      "All (4)",
      "feature (3)",
      "review (1)",
    ]);
    expect(view.runs.map(({ label }) => label)).toEqual([
      "All (3)",
      "r1 · feature (2)",
      "r2 · feature (1)",
    ]);
    expect(view.shown.map(({ id }) => id)).toEqual(["d1", "d2", "d3"]);
  });

  it("ANDs the workflow and the run", () => {
    const view = filterView(
      LIST,
      { workflow: "review", run: "r1" },
      workflowOf,
    );
    expect(view.shown).toEqual([]);
  });

  it("lists a chosen value nothing has now, so the select can show it", () => {
    const view = filterView(LIST, { run: "gone" }, workflowOf);
    expect(view.runs.at(-1)).toEqual({ value: "gone", label: "gone (0)" });
  });

  it("drops only the values no open decision has", () => {
    expect(
      presentOnly(LIST, { workflow: "gone", run: "r3" }, workflowOf),
    ).toEqual({ run: "r3" });
  });

  it("says how many show and how many it hides, and its CLI twin", () => {
    expect(countLine(4, 4)).toBe("4 open decisions.");
    expect(countLine(1, 1)).toBe("1 open decision.");
    expect(countLine(7, 3)).toBe(
      "3 of 7 open decisions shown; 4 hidden by the filter.",
    );
    expect(listCommand({ workflow: "feature" })).toBe(
      "ork decide --list --workflow feature",
    );
    expect(listCommand({ run: "r1" })).toBe("ork decide r1 --list");
  });
});
