/**
 * @file Tests for how the Decisions panel says a decision ended, and who
 *   answered: a person, or the leader that took its child's question first
 *   (ADR-063), and a question a leader passed on.
 */

import type { DecisionRecord } from "@krapht/ork-server/client";
import { describe, expect, it } from "vitest";

import { endingOf } from "../../src/panels/decisions-model.ts";

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
