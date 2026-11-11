/**
 * @file Tests for what a node is doing: folded from the stored events, in a
 *   line, showing only the fields of a tool's input that say what it's working
 *   on.
 */

import { describe, expect, it } from "vitest";

import { activeTree, runActivity } from "../src/store/activity.ts";
import type { StoredEvent } from "../src/store/types.ts";

const stored = (...events: StoredEvent["event"][]): StoredEvent[] =>
  events.map((event, index) => ({
    runId: "r1",
    seq: index + 1,
    at: `2026-11-05T10:00:0${String(index)}.000Z`,
    event,
  }));

const started: StoredEvent["event"] = {
  type: "node.started",
  id: "ui",
  nodeType: "agent.worker",
  round: 1,
};

const tool = (
  name: string,
  input: Record<string, unknown>,
): StoredEvent["event"] => ({
  type: "node.event",
  id: "ui",
  event: { type: "tool.called", id: "t1", name, input },
});

const finished = (
  ok: boolean,
  output: Record<string, unknown>,
  error?: string,
): StoredEvent["event"] => ({
  type: "node.finished",
  id: "ui",
  round: 1,
  ok,
  output,
  ...(error === undefined ? {} : { error }),
});

const nowOf = (...events: StoredEvent["event"][]): string | undefined =>
  runActivity(stored(...events)).get("ui")?.now;

describe("what a node is doing", () => {
  it("names the tool and what it's working on", () => {
    expect(nowOf(started, tool("Edit", { file_path: "docs/a.md" }))).toBe(
      "Edit docs/a.md",
    );
  });

  it("says a tool once when its command starts with it", () => {
    expect(nowOf(started, tool("gh", { command: "gh pr list" }))).toBe(
      "gh pr list",
    );
  });

  it("shows only the fields that say what it's working on", () => {
    expect(nowOf(started, tool("Write", { content: "a secret" }))).toBe(
      "Write",
    );
  });

  it("keeps a command on one short line", () => {
    const line = nowOf(
      started,
      tool("Bash", { command: `pnpm test\n${"x".repeat(200)}` }),
    );
    expect(line?.startsWith("Bash pnpm test x")).toBe(true);
    expect(line).toHaveLength(120);
  });

  it("says what it asked, and what it was told", () => {
    const opened: StoredEvent["event"] = {
      type: "decision.opened",
      node: "ui",
      decision: "d1",
      kind: "question",
      question: "Which one ships?",
      options: [],
    };
    expect(nowOf(started, opened)).toBe("Asked: Which one ships?");
    expect(
      nowOf(started, opened, {
        type: "decision.answered",
        node: "ui",
        decision: "d1",
        answer: "compact",
        by: "ui",
      }),
    ).toBe("Answered: compact");
  });

  it("ends on its summary", () => {
    expect(nowOf(started, finished(true, { summary: "4 files" }))).toBe(
      "4 files",
    );
    expect(nowOf(started, finished(true, {}))).toBeUndefined();
  });

  it("ends on why it failed", () => {
    expect(nowOf(started, finished(false, {}, "exit 1"))).toBe("exit 1");
  });

  it("clears for a new round, and keeps when it first started", () => {
    const events = stored(
      started,
      tool("Edit", { path: "a" }),
      {
        type: "node.finished",
        id: "ui",
        round: 1,
        ok: true,
        output: {},
      },
      { ...started, round: 2 },
    );
    const activity = runActivity(events).get("ui");
    expect(activity?.startedAt).toBe(events[0]?.at);
    expect(activity?.finishedAt).toBeUndefined();
    expect(activity?.now).toBeUndefined();
  });
});

describe("the tree with activity", () => {
  it("dresses each node, and leaves a node that never started bare", () => {
    const events = stored(
      {
        type: "run.started",
        runId: "r1",
        workflow: "w",
        entries: ["ui"],
        nodes: [
          { id: "ui", type: "agent.worker" },
          { id: "ship", type: "tool.shell" },
        ],
      },
      started,
      tool("Edit", { path: "a" }),
    );
    const [ui, ship] = activeTree(events);
    expect(ui?.now).toBe("Edit a");
    expect(ui?.startedAt).toBe(events[1]?.at);
    expect(ship?.now).toBeUndefined();
    expect(ship?.startedAt).toBeUndefined();
  });
});
