/**
 * @file Tests for the one rule `ork feedback` and the Feedback panel share:
 *   which actions an item allows by its target and status, and why not.
 */

import { describe, expect, it } from "vitest";

import {
  type FeedbackItem,
  type FeedbackStatus,
  type FeedbackTarget,
  feedbackActions,
} from "../src/index.ts";

const item = (
  target: FeedbackTarget,
  status: FeedbackStatus,
  workflows: string[] = ["build"],
): FeedbackItem => ({
  id: "abcdef1234567890",
  title: "t",
  target,
  kind: "friction",
  severity: "medium",
  status,
  count: 1,
  runs: ["r1"],
  workflows,
  models: [],
  sources: ["human"],
  firstSeen: "2026-11-06T00:00:00.000Z",
  lastSeen: "2026-11-06T00:00:00.000Z",
  merged: [],
});

/** Each action's short reason, or `ok`. */
const reasons = (of: FeedbackItem) =>
  Object.fromEntries(
    Object.entries(feedbackActions(of)).map(([name, check]) => [
      name,
      check.ok ? "ok" : check.why,
    ]),
  );

describe("which actions an item allows", () => {
  it("lets a new workflow item be accepted, a lesson, or fixed, not shared", () => {
    expect(reasons(item("workflow", "new"))).toEqual({
      accept: "ok",
      lesson: "ok",
      apply: "ok",
      publish: "only feedback about Ork is shared",
    });
  });

  it("lets an item about Ork be accepted or shared, never a lesson or a fix", () => {
    expect(reasons(item("ork", "triaged"))).toEqual({
      accept: "ok",
      lesson: "about Ork itself",
      apply: "about Ork itself",
      publish: "ok",
    });
  });

  it("allows nothing on a dismissed item until it's restored", () => {
    expect(new Set(Object.values(reasons(item("ork", "dismissed"))))).toEqual(
      new Set(["dismissed; restore it first"]),
    );
  });

  it("names what's done already, and a lesson with no workflow", () => {
    expect(reasons(item("workflow", "resolved", []))).toEqual({
      accept: "resolved already",
      lesson: "no workflow recorded, so no lessons file",
      apply: "resolved already",
      publish: "only feedback about Ork is shared",
    });
    expect(reasons(item("ork", "published"))["publish"]).toBe(
      "published already",
    );
  });

  it("starts no second fix beside a running one", () => {
    expect(
      feedbackActions(item("workflow", "accepted"), "fix123").apply,
    ).toEqual({
      ok: false,
      why: "run fix123 is proposing a fix",
      error:
        "Run fix123 is proposing a fix for abcdef123456 already: answer its question in `ork decide` or the UI, or stop it first.",
    });
  });
});
