/**
 * @file Tests for triage by rules (ADR-059): which items are the same problem,
 *   which one the others go under, and the store's merge and split: a merged
 *   item lists under its root, its later records too, until it's split back.
 */

import { describe, expect, it } from "vitest";

import {
  type EventStore,
  type FeedbackItem,
  type FeedbackStatus,
  humanNoteEvent,
  openStore,
  proposeMerges,
  recordNote,
  titleOverlap,
} from "../src/index.ts";

/** An item with only what triage reads. */
const item = (
  id: string,
  title: string,
  status: FeedbackStatus = "new",
  kind: FeedbackItem["kind"] = "context-gap",
): FeedbackItem => ({
  id,
  merged: [],
  status,
  title,
  target: "project",
  kind,
  severity: "medium",
  sources: ["agent"],
  count: 1,
  firstSeen: `2026-01-0${id}`,
  lastSeen: `2026-01-0${id}`,
  runs: [],
  workflows: [],
  models: [],
});

const ids = (merges: ReturnType<typeof proposeMerges>) =>
  merges.map(({ into, from }) => [into.id, from.map(i => i.id)]);

describe("near-duplicate titles", () => {
  it("share at least 80% of their words, numbers and case aside", () => {
    expect(
      titleOverlap(
        "The loop reviews -> lead ran out of its 2 rounds",
        "The loop reviews -> lead ran out of its 3 rounds",
      ),
    ).toBe(1);
    expect(
      titleOverlap(
        "AGENTS.md has no test command",
        "AGENTS.md has no test command yet",
      ),
    ).toBeGreaterThanOrEqual(0.8);
    expect(
      titleOverlap("AGENTS.md has no test command", "The build needs node 24"),
    ).toBeLessThan(0.8);
  });
});

describe("proposed merges", () => {
  it("puts near-duplicates under the one seen first", () => {
    expect(
      ids(
        proposeMerges([
          item("3", "AGENTS.md has no test command yet"),
          item("1", "AGENTS.md has no test command"),
          item("2", "The build needs node 24"),
        ]),
      ),
    ).toEqual([["1", ["3"]]]);
  });

  it("never merges across kinds, or a settled item", () => {
    expect(
      proposeMerges([
        item("1", "AGENTS.md has no test command"),
        item("2", "AGENTS.md has no test command", "new", "skill"),
        item("3", "AGENTS.md has no test command", "accepted"),
        item("4", "AGENTS.md has no test command", "dismissed"),
      ]),
    ).toEqual([]);
  });

  it("compares each with the group's first item, never only with another", () => {
    expect(
      ids(
        proposeMerges([
          item("1", "a b c d"),
          item("2", "a b c d e"),
          item("3", "a b c d e f"),
        ]),
      ),
    ).toEqual([["1", ["2"]]]);
  });

  it("asks only when something new joins a group", () => {
    const triaged = [
      item("1", "AGENTS.md has no test command", "triaged"),
      item("2", "AGENTS.md has no test command yet", "triaged"),
    ];
    expect(proposeMerges(triaged)).toEqual([]);
    expect(
      ids(
        proposeMerges([
          ...triaged,
          item("3", "AGENTS.md has no test command!"),
        ]),
      ),
    ).toEqual([["1", ["2", "3"]]]);
  });
});

/** A store with one run noting each title, in order. */
const noting = (...titles: string[]): EventStore => {
  const store = openStore(":memory:");
  store.begin({
    id: "r1",
    workflow: "w",
    file: "/p/w.ork.yaml",
    project: "/p",
  });
  for (const title of titles) {
    store.append("r1", humanNoteEvent({ text: title, workflow: "w" }));
  }
  return store;
};

/** The id of the item with `title`, failing when there's none. */
const idOf = (store: EventStore, title: string): string => {
  const found = store.feedbackItems().find(i => i.title === title);
  if (found === undefined) throw new Error(`No item "${title}".`);
  return found.id;
};

describe("merging in the store", () => {
  it("lists a merged item under its root, with its later records", () => {
    const store = noting("No test command", "No test command at all");
    const root = idOf(store, "No test command");
    const other = idOf(store, "No test command at all");
    expect(store.mergeFeedback(root, [other])).toBe(1);
    store.append(
      "r1",
      humanNoteEvent({ text: "No test command at all", workflow: "w" }),
    );
    const items = store.feedbackItems();
    expect(items.map(i => [i.id, i.count, i.merged])).toEqual([
      [root, 3, [other]],
    ]);
    expect(store.feedbackRecords(root)).toHaveLength(3);
    const noted = recordNote(
      store,
      { id: "r1", workflow: "w" },
      { text: "No test command at all" },
    );
    expect(noted).toEqual({ ok: true, item: root });
    expect(store.findFeedback(other).map(i => i.id)).toEqual([root]);
  });

  it("follows a merged item's own merges, and splits them back", () => {
    const store = noting("a b c d e", "a b c d e f", "a b c d e g");
    const a = idOf(store, "a b c d e");
    const b = idOf(store, "a b c d e f");
    store.mergeFeedback(b, [idOf(store, "a b c d e g")]);
    expect(store.mergeFeedback(a, [b])).toBe(2);
    expect(store.feedbackItems()).toHaveLength(1);
    expect(store.splitFeedback(a)).toBe(2);
    expect(store.feedbackItems()).toHaveLength(3);
  });
});
