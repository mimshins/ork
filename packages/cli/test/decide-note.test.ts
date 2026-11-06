/**
 * @file Tests for `ork decide --note`: after an answer, a note or a rating on
 *   the decision's node joins the run's feedback; nothing is noted without one,
 *   and a decision that isn't there is named.
 */

import { type EventStore, openStore } from "@krapht/ork-core";
import { describe, expect, it } from "vitest";

import { noteDecision } from "../src/commands/decide.ts";

/** A run whose `review` node asked decision `d1`. */
const asked = (): EventStore => {
  const store = openStore(":memory:");
  store.begin({
    id: "r1",
    workflow: "ship",
    file: "/p/ship.ork.yaml",
    project: "/p",
  });
  store.append("r1", {
    type: "node.started",
    id: "review",
    nodeType: "human.gate",
    round: 1,
  });
  store.openDecision({
    id: "d1",
    runId: "r1",
    node: "review",
    kind: "question",
    question: "Ship it?",
    options: [{ id: "ship" }, { id: "hold" }],
  });
  return store;
};

describe("ork decide --note", () => {
  it("notes the decision's node, as the person's feedback", () => {
    const store = asked();
    const noted = noteDecision(
      store,
      "d1",
      "The summary hid the failing test",
      "bad",
    );
    const [item] = store.feedbackItems();
    expect(noted).toEqual({ ok: true, item: item?.id });
    expect(item).toMatchObject({
      title: "The summary hid the failing test",
      severity: "high",
      sources: ["human"],
    });
    expect(store.feedbackRecords(String(item?.id)).map(r => r.node)).toEqual([
      "review",
    ]);
  });

  it("takes a rating alone, and notes nothing without either", () => {
    const store = asked();
    expect(noteDecision(store, "d1")).toBeUndefined();
    expect(store.feedbackItems()).toEqual([]);
    expect(noteDecision(store, "d1", undefined, "good")?.ok).toBe(true);
    expect(store.feedbackItems()[0]?.title).toBe("Rated good at Ship it?");
  });

  it("names a decision that isn't there, and a rating it doesn't know", () => {
    const store = asked();
    expect(noteDecision(store, "nope", "x")).toEqual({
      ok: false,
      error: "No decision nope to note.",
    });
    expect(noteDecision(store, "d1", "x", "meh")).toEqual({
      ok: false,
      error: "rating is one of good, bad",
    });
  });
});
