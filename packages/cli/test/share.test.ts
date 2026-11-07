/**
 * @file Tests for moving feedback off the machine: export and import as JSON
 *   lines (round trip, duplicates skipped, bad lines named, secrets masked
 *   again), and the preview of a publish (only items about Ork, redacted, names
 *   hidden when asked).
 */

import {
  type EventStore,
  type FeedbackItem,
  humanNoteEvent,
  openStore,
  planPost,
  previewPost,
  type GhRunner,
  type Post,
  type PostPlan,
} from "@krapht/ork-core";
import { describe, expect, it } from "vitest";

import { exportLines, parseLines } from "../src/runs/jsonl.ts";
import { formatPreview } from "../src/runs/publish.ts";

const ROOT = "/Users/ann/code/acme";

/** A store with a run in `ROOT` noting `text` as `kind`. */
const noted = (text: string, kind: "bug" | "friction" = "bug"): EventStore => {
  const store = openStore(":memory:");
  store.begin({
    id: "r1",
    workflow: "release",
    file: `${ROOT}/.ork/workflows/release.ork.yaml`,
    project: ROOT,
  });
  store.append("r1", humanNoteEvent({ text, workflow: "release", kind }));
  return store;
};

const only = (store: EventStore): FeedbackItem => {
  const [item] = store.feedbackItems();
  if (item === undefined) throw new Error("No item.");
  return item;
};

describe("export and import", () => {
  it("round-trips records, and skips the ones already here", () => {
    const from = noted("The tool crashed");
    const lines = exportLines(from.exportFeedback());
    const parsed = parseLines(lines);
    expect(parsed.problems).toEqual([]);
    const into = openStore(":memory:");
    expect(parsed.records.map(r => into.importFeedback(r))).toEqual([true]);
    expect(parsed.records.map(r => into.importFeedback(r))).toEqual([false]);
    expect(only(into)).toMatchObject({ title: "The tool crashed", count: 1 });
  });

  it("leaves out dismissed items unless asked, and names bad lines", () => {
    const store = noted("The tool crashed");
    store.setFeedbackStatus(only(store).id, "dismissed");
    expect(store.exportFeedback()).toEqual([]);
    expect(store.exportFeedback({ all: true })).toHaveLength(1);
    expect(
      parseLines('{"x":1}\nnot json\n\n{"feedbackVersion":2,"y":1}\n').problems,
    ).toEqual([
      "line 1: feedbackVersion Invalid input: expected 1",
      "line 2: not JSON",
      "line 4: made by a newer Ork (`feedbackVersion: 2`; this one reads 1). Upgrade with `ork upgrade`.",
    ]);
  });

  it("masks secrets again on import", () => {
    const [line = ""] = exportLines(noted("crashed").exportFeedback()).split(
      "\n",
    );
    const tampered = line.replace(
      '"body":"crashed"',
      '"body":"token ghp_abcdefghijklmnopqrstuvwxyz0123456789"',
    );
    const into = openStore(":memory:");
    for (const record of parseLines(tampered).records)
      into.importFeedback(record);
    expect(into.feedbackRecords(only(into).id)[0]?.feedback.body).toBe(
      "token [masked]",
    );
  });
});

/** The post an item about Ork makes, failing when it isn't shared. */
const postOf = (store: EventStore): Post => {
  const shown = previewPost(store, only(store), {
    home: "/Users/ann",
    registered: [],
    hideNames: false,
  });
  if (!shown.ok) throw new Error(shown.error);
  return shown.post;
};

const planOf = (planned: Awaited<ReturnType<typeof planPost>>): PostPlan => {
  if (!planned.ok) throw new Error(planned.error);
  return planned.plan;
};

const answer = (data: unknown) =>
  Promise.resolve({ ok: true, stderr: "", stdout: JSON.stringify({ data }) });

/** A `gh` for a category with no threads yet. */
const emptyCategory: GhRunner = args =>
  String(args[3]).includes("discussionCategory(")
    ? answer({ repository: { id: "R", discussionCategory: { id: "C" } } })
    : answer({ repository: { discussions: { nodes: [] } } });

describe("the publish preview", () => {
  it("shares only items about Ork", () => {
    const store = noted("The brief was vague", "friction");
    expect(
      previewPost(store, only(store), {
        home: "/Users/ann",
        registered: [],
        hideNames: false,
      }),
    ).toMatchObject({ ok: false });
  });

  it("rewrites the run's project, and hides names when asked", () => {
    const store = noted(`The tool crashed in ${ROOT}/release`);
    const shown = previewPost(store, only(store), {
      home: "/Users/ann",
      registered: [],
      hideNames: true,
    });
    expect(shown).toMatchObject({
      ok: true,
      post: { title: "The tool crashed in <project>/<name>" },
    });
  });

  it("says which: a new thread, or a +1 on the one there", async () => {
    const post = postOf(noted("The tool crashed"));
    const planned = await planPost(post, emptyCategory);
    expect(formatPreview(post, planOf(planned))[0]).toBe(
      "A new thread in the Agent feedback category of mimshins/ork:",
    );
  });
});
