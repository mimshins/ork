/**
 * @file Tests for the label of a finished node in the transcript: it follows
 *   whether the node failed and whether its work merged, not only the status
 *   its report claims.
 */

import type { RunEvent } from "@krapht/ork-core";
import { describe, expect, it } from "vitest";

import { formatRunEvent } from "../src/index.ts";

/** Colors off: lines compare as plain text. */
const plain = (line: string): string =>
  // oxlint-disable-next-line no-control-regex -- strips the terminal's escape codes
  line.replaceAll(/\u001B\[[0-9;]*m/gu, "");

const finished = (
  fields: Pick<
    Extract<RunEvent, { type: "node.finished" }>,
    "ok" | "output"
  > & { error?: string },
): string[] =>
  formatRunEvent(
    { type: "node.finished", id: "w", round: 1, ...fields },
    4,
    new Map(),
  ).map(text => plain(text));

describe("a finished node's label", () => {
  it("reads fail when the node failed, whatever its report says", () => {
    expect(
      finished({
        ok: false,
        output: { status: "pass", summary: "done" },
        error: "hook refused the commit",
      }),
    ).toEqual(["w    │ ✗ fail: hook refused the commit"]);
  });

  it("keeps the report's own words for a failure it reported", () => {
    expect(
      finished({ ok: false, output: { status: "fail", summary: "no" } }),
    ).toEqual(["w    │ ✗ fail: no"]);
  });

  it("reads a conflicted child as passed, with a merge conflict", () => {
    expect(
      finished({
        ok: true,
        output: {
          status: "pass",
          summary: "ok",
          merge: { ok: false, conflicts: ["a.ts"], into: "ork/r/lead" },
        },
      }),
    ).toEqual(["w    │ ! pass, merge conflict: ok"]);
  });

  it("leaves a plain pass alone", () => {
    expect(
      finished({ ok: true, output: { status: "pass", summary: "ok" } }),
    ).toEqual(["w    │ ✓ pass: ok"]);
  });
});

const asked: RunEvent = {
  type: "decision.opened",
  node: "w",
  decision: "r-1",
  kind: "question",
  question: "ship?",
  options: [],
};

describe("the transcript's lines for decisions and worktrees", () => {
  it("points at ork decide when no terminal asks", () => {
    expect(
      formatRunEvent(asked, 4, new Map()).map(text => plain(text)),
    ).toEqual(["w    │ ? asks: ship? (decision r-1; ork decide)"]);
  });

  it("says to answer here when the terminal asks", () => {
    expect(
      formatRunEvent(asked, 4, new Map(), true).map(text => plain(text)),
    ).toEqual([
      "w    │ ? asks: ship? (decision r-1; answer here or with ork decide)",
    ]);
  });

  it("says a removed worktree's branch is kept", () => {
    expect(
      formatRunEvent(
        {
          type: "worktree",
          id: "worker",
          action: "removed",
          path: "/tmp/w",
          branch: "ork/r/worker",
        },
        6,
        new Map(),
      ).map(text => plain(text)),
    ).toEqual(["worker │ ⎇ removed worktree of ork/r/worker (branch kept)"]);
  });
});
