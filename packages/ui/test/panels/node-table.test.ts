/**
 * @file Tests for what the Monitor's node table says of a node besides its
 *   status, and for what an edge of a run shows: its node decides both.
 */

import type { TreeNode } from "@krapht/ork-server/client";
import { describe, expect, it } from "vitest";

import type { Status } from "../../src/components/status-badge.tsx";
import { edgeStateOf } from "../../src/graph/edge-paths.tsx";
import { formatElapsed } from "../../src/graph/facts.ts";
import {
  doneCount,
  leftOut,
  nowLine,
  timeLine,
} from "../../src/panels/node-table.ts";
import { treeNode } from "./monitor-fixtures.ts";

const NOW = Date.parse("2026-11-05T10:10:00.000Z");
const EDGES = [
  { from: "ci", to: "ship" },
  { from: "docs", to: "ship" },
];

const statuses: Record<string, Status> = { ci: "running", docs: "succeeded" };
const statusOf = (id: string): Status | undefined => statuses[id];

const nowOf = (id: string, over: Partial<TreeNode>, status: Status): string =>
  nowLine(treeNode(id, over), status, EDGES, statusOf, NOW);

const onlyDocsQueued = (id: string): Status | undefined =>
  id === "docs" ? "queued" : undefined;

describe("what a node is doing", () => {
  it("says what a queued node is still waiting for", () => {
    expect(nowOf("ship", {}, "queued")).toBe("After ci");
  });

  it("names a queued node's unstarted sources too", () => {
    expect(
      nowLine(treeNode("ship"), "queued", EDGES, onlyDocsQueued, NOW),
    ).toBe("After ci and docs");
  });

  it("says nothing of a queued node with nothing before it", () => {
    expect(nowOf("first", {}, "queued")).toBe("");
  });

  it("shows what the server says it did", () => {
    expect(nowOf("ui", { now: "Edit a.md" }, "running")).toBe("Edit a.md");
  });

  it("counts a wait's looks, which move with the clock", () => {
    const watching = {
      until: "json.ok",
      every: "1m",
      timeout: "2h",
      startedAt: "2026-11-05T10:00:00.000Z",
      looks: 3,
      at: "2026-11-05T10:05:00.000Z",
    };
    expect(nowOf("ci", { watching }, "running")).toBe(
      "About 8 looks, next in about 1 min",
    );
  });
});

describe("a wait's first look", () => {
  it("is one look, not one looks", () => {
    const watching = {
      until: "json.ok",
      every: "1h",
      timeout: "2h",
      startedAt: "2026-11-05T10:09:00.000Z",
      looks: 1,
      at: "2026-11-05T10:09:00.000Z",
    };
    expect(nowOf("ci", { watching }, "running")).toMatch(/^1 look, next/u);
  });
});

describe("how long a node took", () => {
  it("has no time before it starts", () => {
    expect(timeLine({}, undefined, NOW)).toBe("–");
  });

  it("counts up while it runs", () => {
    expect(
      timeLine({ startedAt: "2026-11-05T10:06:00.000Z" }, undefined, NOW),
    ).toBe("4:00");
  });

  it("stops when it finishes", () => {
    expect(
      timeLine(
        {
          startedAt: "2026-11-05T10:06:00.000Z",
          finishedAt: "2026-11-05T10:06:30.000Z",
        },
        undefined,
        NOW,
      ),
    ).toBe("0:30");
  });

  it("stops when its run ended, if it never finished", () => {
    expect(
      timeLine(
        { startedAt: "2026-11-05T10:06:00.000Z" },
        "2026-11-05T10:07:00.000Z",
        NOW,
      ),
    ).toBe("1:00");
  });

  it.each([
    [0, "0:00"],
    [61_000, "1:01"],
    [3_723_000, "1:02:03"],
    [-5000, "0:00"],
  ])("writes %d ms as %s", (ms, shown) => {
    expect(formatElapsed(ms)).toBe(shown);
  });
});

describe("the nodes done", () => {
  it("counts those that came to an end", () => {
    expect(doneCount(["succeeded", "failed", "running", "queued"])).toBe(
      "2 / 4",
    );
  });

  it("says what a finished run skipped and which failures it handled", () => {
    expect(leftOut({ skipped: 2, failuresHandled: 1 })).toBe(
      "2 skipped · 1 failure handled",
    );
    expect(leftOut({ failuresHandled: 3 })).toBe("3 failures handled");
    expect(leftOut({ skipped: 0, failuresHandled: 0 })).toBeNull();
    expect(leftOut({})).toBeNull();
  });
});

describe("an edge of a run", () => {
  it.each([
    ["running", "flowing"],
    ["queued", "pending"],
    ["skipped", "pending"],
    ["succeeded", "taken"],
    ["waiting", "taken"],
  ] as const)("leading to a node that's %s is %s", (status, state) => {
    expect(edgeStateOf("flow", { status })).toBe(state);
  });

  it("keeps its own line for a loop or a channel", () => {
    expect(edgeStateOf("back", { status: "running" })).toBeUndefined();
    expect(edgeStateOf("message", { status: "running" })).toBeUndefined();
  });

  it("shows nothing of how far it got outside a run", () => {
    expect(edgeStateOf("flow")).toBeUndefined();
  });
});
