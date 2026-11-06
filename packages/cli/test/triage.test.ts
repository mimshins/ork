/**
 * @file Tests for `ork feedback triage` and `split`: each proposed merge is
 *   made only when the person says yes, every new item is then `triaged`, a
 *   second triage asks nothing, and `show` names what was merged.
 */

import {
  type EventStore,
  type FeedbackItem,
  humanNoteEvent,
  openStore,
  type ProposedMerge,
} from "@krapht/ork-core";
import { describe, expect, it } from "vitest";

import { formatFeedbackItem } from "../src/runs/feedback.ts";
import { formatMerge, triage, triageSummary } from "../src/runs/triage.ts";

const TITLES = [
  "AGENTS.md has no test command",
  "AGENTS.md has no test command yet",
  "The build needs node 24",
];

const noted = (): EventStore => {
  const store = openStore(":memory:");
  store.begin({
    id: "r1",
    workflow: "w",
    file: "/p/w.ork.yaml",
    project: "/p",
  });
  for (const text of TITLES) {
    store.append("r1", humanNoteEvent({ text, workflow: "w" }));
  }
  return store;
};

/** The item with `title`, failing when there's none. */
const theItem = (store: EventStore, title: string): FeedbackItem => {
  const found = store.feedbackItems().find(i => i.title === title);
  if (found === undefined) throw new Error(`No item "${title}".`);
  return found;
};

/** Answers every merge with `yes`, recording what it was asked. */
const answering = (yes: boolean) => {
  const asked: ProposedMerge[] = [];
  return {
    asked,
    ask: (merge: ProposedMerge) => {
      asked.push(merge);
      return Promise.resolve(yes);
    },
  };
};

describe("ork feedback triage", () => {
  it("merges what the person says yes to, and triages every new item", async () => {
    const store = noted();
    const person = answering(true);
    const done = await triage(store, person.ask);
    expect(done).toEqual({ merged: 1, declined: 0, triaged: 3 });
    expect(triageSummary(done)).toBe("merged 1 item(s); 3 new item(s) triaged");
    expect(person.asked.map(m => formatMerge(m)[0])).toEqual([
      expect.stringContaining("AGENTS.md has no test command"),
    ]);
    expect(
      store.feedbackItems().map(i => [i.title, i.count, i.status]),
    ).toEqual(
      expect.arrayContaining([
        ["AGENTS.md has no test command", 2, "triaged"],
        ["The build needs node 24", 1, "triaged"],
      ]),
    );
  });

  it("keeps a declined merge apart, and doesn't ask again", async () => {
    const store = noted();
    const first = await triage(store, answering(false).ask);
    expect(first).toEqual({ merged: 0, declined: 1, triaged: 3 });
    expect(store.feedbackItems()).toHaveLength(3);
    const again = answering(true);
    expect(await triage(store, again.ask)).toEqual({
      merged: 0,
      declined: 0,
      triaged: 0,
    });
    expect(again.asked).toEqual([]);
  });

  it("names what was merged into an item, and split takes it apart", async () => {
    const store = noted();
    await triage(store, answering(true).ask);
    const merged = theItem(store, "AGENTS.md has no test command");
    const lines = formatFeedbackItem(
      merged,
      store.feedbackRecords(merged.id),
    ).join("\n");
    expect(lines).toContain("Merged into it:");
    expect(store.splitFeedback(merged.id)).toBe(1);
    expect(store.feedbackItems()).toHaveLength(3);
  });
});
