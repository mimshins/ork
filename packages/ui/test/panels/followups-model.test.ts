/**
 * @file Tests for the Follow-ups panel's model: what the filter bar suggests
 *   and when a failed read is the server refusing a filter value, the list
 *   grouped by due and then by who it is for, why a row is due, the summary
 *   words, and which buttons an item has with the CLI each stands for.
 */

import type { FollowUp } from "@krapht/ork-server/client";
import { describe, expect, it } from "vitest";

import {
  actsFor,
  doneWords,
  labelOf,
  nextAfter,
} from "../../src/panels/followups-acts.ts";
import {
  dueGroupOf,
  type FollowUpRow,
  forSuggestions,
  groupRows,
  orderedRows,
  refusalOf,
  refWords,
  summaryOf,
  whyDue,
} from "../../src/panels/followups-model.ts";
import {
  DANA,
  followUp,
  MESSAGE,
  MIGRATION,
  OLD,
  RETRIES,
} from "./followups-harness.tsx";

const asRow = (f: FollowUp, over: Partial<FollowUpRow> = {}): FollowUpRow =>
  Object.assign({}, f, { projectId: "api" }, over);

const ROWS: FollowUpRow[] = [MESSAGE, MIGRATION, RETRIES, DANA, OLD].map(f =>
  asRow(f),
);

const NOW = new Date(2026, 10, 12, 10, 0, 0);

describe("the filter bar's help", () => {
  it("suggests the project and person targets the rows have, agent and me being the bar's own", () => {
    expect(forSuggestions(ROWS).map(s => s.value)).toEqual([
      "person:acme-ops",
      "person:dana",
    ]);
  });

  it("reads a message that starts with a table's flag as a refusal of that field", () => {
    expect(refusalOf("--status takes one of due, waiting, not `x`.")).toEqual({
      message: "--status takes one of due, waiting, not `x`.",
      field: "status",
    });
  });

  it("reads anything else as a read that failed", () => {
    expect(refusalOf("Nothing answers.")).toBeNull();
    expect(refusalOf("--bogus takes nothing.")).toBeNull();
  });
});

describe("the list's groups", () => {
  it("groups by due, then by for, with a past date overdue", () => {
    const groups = groupRows(ROWS.slice(0, 4), "2026-11-12");
    expect(groups.map(g => g.label)).toEqual([
      "Now",
      "After merge",
      "Overdue · 2020-01-01",
    ]);
    expect(groups[1]?.groups.map(g => g.for)).toEqual([
      "agent",
      "person:acme-ops",
    ]);
  });

  it("puts dates after the words, ascending, and a future date By", () => {
    const rows = [
      asRow(MESSAGE, { due: "2026-12-01" }),
      asRow(MIGRATION, { due: "2026-11-20" }),
      asRow(RETRIES, { due: "after-deploy" }),
    ];
    expect(groupRows(rows, "2026-11-12").map(g => g.label)).toEqual([
      "After deploy",
      "By 2026-11-20",
      "By 2026-12-01",
    ]);
    expect(
      dueGroupOf(asRow(MIGRATION, { due: "2026-11-20" }), "2026-11-12").key,
    ).toBe("2026-11-20");
  });

  it("orders inside a group: due, waiting, done, dropped, then newest first", () => {
    const rows = [
      asRow(followUp("a", { status: "dropped" })),
      asRow(followUp("b", { status: "done" })),
      asRow(followUp("c", { status: "waiting" })),
      asRow(followUp("d", { status: "due" })),
    ];
    expect(
      orderedRows(groupRows(rows, "2026-11-12")).map(f => f.status),
    ).toEqual(["due", "waiting", "done", "dropped"]);
  });
});

describe("the words", () => {
  it("says why a due row is due", () => {
    expect(whyDue(asRow(MESSAGE), NOW)).toBe("PR merged");
    const closed = asRow(MESSAGE, {
      note: "feature was closed without merging; decide",
    });
    expect(whyDue(closed, NOW)).toBe("closed unmerged");
    expect(whyDue(asRow(MIGRATION, { due: "2026-11-10" }), NOW)).toBe(
      "overdue 2 d",
    );
    expect(whyDue(asRow(MIGRATION), NOW)).toBeUndefined();
  });

  it("summarises what is open", () => {
    expect(summaryOf(ROWS)).toBe("2 due, 2 waiting");
    expect(summaryOf(ROWS.slice(2, 3))).toBe("None due, 1 waiting");
    expect(summaryOf([])).toBe("Nothing open");
  });

  it("writes a PR ref as #n and a branch as it is", () => {
    expect(refWords("https://github.com/a/b/pull/142")).toBe("#142");
    expect(refWords("feature/webhook")).toBe("feature/webhook");
  });
});

const words = (f: FollowUpRow): string[] => actsFor(f).map(a => a.word);

describe("the buttons", () => {
  it("gives each status its buttons, the finishing one primary only when due", () => {
    expect(words(asRow(MIGRATION, { status: "waiting" }))).toEqual([
      "Mark due",
      "Mark done",
      "Drop",
    ]);
    expect(actsFor(asRow(MIGRATION)).map(a => [a.word, a.variant])).toEqual([
      ["Mark done", "primary"],
      ["Drop", "default"],
    ]);
    expect(words(asRow(MIGRATION, { status: "done" }))).toEqual(["Reopen"]);
    expect(words(asRow(MIGRATION, { status: "dropped" }))).toEqual(["Reopen"]);
  });

  it("says Mark sent for a message, with the CLI twins by short id", () => {
    expect(actsFor(asRow(MESSAGE))[0]).toMatchObject({
      word: "Mark sent",
      cli: "ork follow-ups done 4f2a1c",
    });
  });

  it("ends a disabled button's name with the server's reason", () => {
    const refused = {
      ok: false,
      kind: "status",
      why: "it is locked",
      error: "x",
    } as const;
    const [, done] = actsFor(asRow(MIGRATION, { status: "waiting" }), {
      done: refused,
      drop: { ok: true },
      due: { ok: true },
      post: { ok: true },
      reopen: refused,
    });
    expect(done?.check).toEqual(refused);
    expect(
      labelOf("Reopen", {
        ok: false,
        kind: "status",
        why: "it is done",
        error: "x",
      }),
    ).toBe("Reopen: it is done");
  });

  it("says what was done aloud, and hands the choice to the next row", () => {
    expect(doneWords("done", asRow(MESSAGE))).toBe(
      "Marked sent: Message Acme about the webhook change.",
    );
    expect(doneWords("drop", asRow(MIGRATION))).toBe(
      "Dropped: Run the migration.",
    );
    const before = [asRow(MESSAGE), asRow(MIGRATION), asRow(RETRIES)];
    const after = before.filter(f => f.id !== MIGRATION.id);
    expect(nextAfter(before, after, MIGRATION.id)?.id).toBe(RETRIES.id);
    expect(nextAfter(before, [], MIGRATION.id)).toBeUndefined();
  });
});
