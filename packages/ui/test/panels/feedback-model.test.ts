/**
 * @file Tests for what the Feedback panel and its Note and lesson dialogs work
 *   out: what the filters leave and the words with nothing left, where the
 *   choice goes when an item leaves, which buttons an item shows and why each
 *   is off (the server's reason, or that it's still being read), the CLI twins
 *   that leave out what's the default, and the severity a bad rating raises.
 */

import { describe, expect, it } from "vitest";

import {
  buttonsFor,
  emptyWords,
  labelOf,
  mergedInto,
  nextAfter,
  panelShows,
  shownItems,
} from "../../src/panels/feedback-model.ts";
import { lessonBlocked, lessonCommand } from "../../src/panels/lesson-model.ts";
import { noteAction } from "../../src/panels/monitor-model.ts";
import {
  EMPTY_NOTE,
  noteBody,
  noteCommand,
  severityOf,
} from "../../src/panels/note-model.ts";
import {
  AGENTS,
  detailOf,
  item,
  ITEMS,
  LOOP,
  ORK,
  refused,
  whole,
} from "./feedback-fixtures.ts";
import { treeNode } from "./monitor-fixtures.ts";

const keys = (specs: { key: string }[]): string[] => specs.map(s => s.key);

describe("the Feedback panel's filters", () => {
  it("hide the dismissed ones while no status is asked for", () => {
    const items = [...ITEMS, item("aaaa", { status: "dismissed" })];
    expect(shownItems(items, { values: {}, about: "all" })).toHaveLength(3);
    expect(
      shownItems(items, { values: { status: "all" }, about: "all" }),
    ).toHaveLength(4);
    expect(
      shownItems(items, { values: { status: "dismissed" }, about: "all" }),
    ).toHaveLength(4);
  });

  it("leave what matches what it's about, besides the server's answer", () => {
    const shown = shownItems(ITEMS, { values: {}, about: "project" });
    expect(shown.map(({ id }) => id)).toEqual([whole(AGENTS)]);
  });

  it("say what's missing, and which filter shows the rest", () => {
    expect(emptyWords({ status: "dismissed", about: "all" })).toEqual({
      title: "Nothing dismissed.",
      body: "Status: All shows every item.",
    });
    expect(emptyWords({ status: "all", about: "ork" })).toEqual({
      title: "No items about ork.",
      body: "About: All shows every item.",
    });
    expect(emptyWords({ status: "open", about: "all" }).title).toBe(
      "Every item is dismissed.",
    );
  });
});

describe("where the choice goes", () => {
  it("goes on to the next item, or back from the last", () => {
    const after = ITEMS.slice(1);
    expect(nextAfter(ITEMS, after, whole(LOOP))?.id).toBe(whole(AGENTS));
    expect(nextAfter(ITEMS, ITEMS.slice(0, 2), whole(ORK))?.id).toBe(
      whole(AGENTS),
    );
    expect(nextAfter([item(LOOP)], [], whole(LOOP))).toBeUndefined();
  });

  it("follows an item into the one it was merged into", () => {
    const root = item(LOOP, { merged: [whole(AGENTS)] });
    expect(mergedInto([root], whole(AGENTS))?.id).toBe(whole(LOOP));
  });
});

describe("what the panel shows", () => {
  it.each([
    [false, "detail", null, "both"],
    [false, "list", "a", "both"],
    [true, "list", "a", "list"],
    [true, "detail", "a", "detail"],
    [true, "detail", null, "list"],
  ] as const)(
    "narrow %s, asked for %s, chosen %s: %s",
    (narrow, showing, chosen, shows) => {
      expect(panelShows(narrow, showing, chosen)).toBe(shows);
    },
  );
});

describe("an item's buttons", () => {
  it("are the target's, waiting on the server before any is enabled", () => {
    const workflow = buttonsFor(item(LOOP), null);
    expect(keys(workflow)).toEqual(["accept", "lesson", "apply"]);
    expect(workflow.map(({ check }) => check)).toEqual([
      { ok: false, why: "reading what it allows" },
      { ok: false, why: "reading what it allows" },
      { ok: false, why: "reading what it allows" },
    ]);
    expect(keys(buttonsFor(item(ORK, { target: "ork" }), null))).toEqual([
      "accept",
      "publish",
    ]);
  });

  it("take the server's reasons, then where the project is", () => {
    const of = item(LOOP);
    const detail = detailOf(of, {
      actions: {
        accept: refused("accepted already"),
        lesson: { ok: true },
        apply: { ok: true },
        publish: refused("only feedback about Ork is shared"),
      },
      project: { ok: false, error: "The project is gone." },
    });
    expect(
      buttonsFor(of, detail).map(({ word, check }) => labelOf(word, check)),
    ).toEqual([
      "Accept: accepted already",
      "Add lesson…",
      "Propose fix…: The project is gone.",
    ]);
  });
});

describe("a lesson", () => {
  it("names the workflow only when there was a choice, and words that differ", () => {
    const one = item(LOOP, { title: "Use the spec" });
    expect(lessonCommand(one, "review-loop", "Use the spec")).toBe(
      "ork feedback accept 9fae0c1d2e3f --lesson",
    );
    const two = item(LOOP, { workflows: ["a", "b"] });
    expect(lessonCommand(two, "b", "It's at nodes.spec")).toBe(
      "ork feedback accept 9fae0c1d2e3f --lesson --workflow b -m 'It'\\''s at nodes.spec'",
    );
  });

  it("waits for a workflow and for words", () => {
    expect(lessonBlocked(null, "x")).toBe("Choose a workflow.");
    expect(lessonBlocked("a", " ")).toBe("Write the lesson first.");
  });
});

describe("a note", () => {
  it("is high from a bad rating, until the person picks a severity", () => {
    const bad = { ...EMPTY_NOTE, text: "x", rating: "bad" };
    expect(severityOf(bad)).toBe("high");
    expect(severityOf({ ...bad, severity: "low" })).toBe("low");
    expect(severityOf(EMPTY_NOTE)).toBe("medium");
  });

  it("names in its CLI twin only what isn't the default", () => {
    const draft = { ...EMPTY_NOTE, text: "Slow", rating: "bad" };
    expect(noteCommand("aaa11111", "reviews", draft)).toBe(
      "ork feedback note aaa11111 reviews -m Slow --rating bad",
    );
    expect(
      noteCommand("aaa11111", undefined, { ...draft, severity: "low" }),
    ).toBe("ork feedback note aaa11111 -m Slow --severity low --rating bad");
    expect(noteCommand("aaa11111", undefined, EMPTY_NOTE)).toBe(
      "ork feedback note aaa11111 -m <text>",
    );
  });

  it("sends the severity it shows, and no rating when there's none", () => {
    expect(noteBody(undefined, { ...EMPTY_NOTE, text: "Slow" })).toEqual({
      text: "Slow",
      kind: "friction",
      severity: "medium",
    });
  });

  it("goes only on a node that ran", () => {
    expect(noteAction(treeNode("a", { state: "waiting" }))).toEqual({
      enabled: false,
      why: "it hasn't run",
    });
    expect(noteAction(treeNode("a", { state: "skipped" })).enabled).toBe(false);
    expect(noteAction(treeNode("a", { state: "ok" }))).toEqual({
      enabled: true,
    });
  });
});
