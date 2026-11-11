/**
 * @file Tests for how the API serves how nodes ended: the registry's label,
 *   actor and hint resolved onto each `node.finished` and tree node, a run
 *   stored before ends existed read through its text, and a hint that sends the
 *   reader to Details dropped when there is no detail.
 */

import {
  endFor,
  type RunEvent,
  type StoredEvent,
  type TreeNode,
} from "@krapht/ork-core";
import { describe, expect, it } from "vitest";

import { endViewOf, servedEvent, treeWithEnds } from "../src/end-view.ts";

const stored = (seq: number, event: RunEvent): StoredEvent => ({
  runId: "r",
  seq,
  at: "2026-11-03T00:00:00.000Z",
  event,
});

const node = (id: string, over: Partial<TreeNode> = {}): TreeNode => ({
  id,
  type: "agent.worker",
  state: "failed",
  runs: 1,
  costUsd: 0,
  inputTokens: 0,
  outputTokens: 0,
  children: [],
  ...over,
});

describe("an end as the API serves it", () => {
  it("has the kind's label, who acts, whether it may pass, and what to do", () => {
    const view = endViewOf(endFor("rate_limited", {}, "HTTP 429"));
    expect(view).toMatchObject({
      kind: "rate_limited",
      label: "Rate limited",
      actor: "provider",
      transient: true,
      detail: "HTTP 429",
      docsAnchor: "rate-limited",
    });
    expect(view.hint).toContain("ork resume");
  });

  it("drops the sentence that points to Details when there is no detail", () => {
    expect(endViewOf(endFor("command_failed")).hint).toBe("");
    expect(endViewOf(endFor("driver_crashed")).hint).toBe(
      "Ork files it as a bug.",
    );
    expect(endViewOf(endFor("command_failed", {}, "oops")).hint).toBe(
      "Its output is under Details.",
    );
  });

  it("has no actor for a node that finished well", () => {
    expect(endViewOf(endFor("done"))).toMatchObject({
      actor: null,
      hint: "",
    });
  });
});

const finished = (extra: object): RunEvent => ({
  type: "node.finished",
  id: "a",
  round: 1,
  ok: false,
  output: {},
  ...extra,
});

describe("a node.finished as the API serves it", () => {
  it("keeps the end it was stored with", () => {
    const { event } = servedEvent(
      stored(1, finished({ end: endFor("turn_limit", { maxTurns: 8 }) })),
    );
    expect(event).toMatchObject({
      end: { kind: "turn_limit", message: "reached its turn limit (8)" },
    });
  });

  it("reads an event stored before ends existed from its text", () => {
    const { event } = servedEvent(
      stored(
        1,
        finished({ error: "Claude ended without a report (error_max_turns)" }),
      ),
    );
    expect(event).toMatchObject({ end: { kind: "turn_limit" } });
  });

  it("gives `unknown` when nothing matches, and done when it passed", () => {
    expect(
      servedEvent(stored(1, finished({ error: "gibberish" }))).event,
    ).toMatchObject({ end: { kind: "unknown", detail: "gibberish" } });
    expect(servedEvent(stored(2, finished({ ok: true }))).event).toMatchObject({
      end: { kind: "done", actor: null },
    });
  });

  it("leaves other events as they are", () => {
    const skipped = stored(1, { type: "node.skipped", id: "a" });
    expect(servedEvent(skipped)).toEqual(skipped);
  });
});

describe("the tree with each node's latest end", () => {
  it("gives a node the end of its last round, none while it runs again", () => {
    const events = [
      stored(1, {
        type: "node.finished",
        id: "a",
        round: 1,
        ok: false,
        output: {},
        end: endFor("rate_limited"),
      }),
      stored(2, {
        type: "node.finished",
        id: "b",
        round: 1,
        ok: false,
        output: {},
        end: endFor("turn_limit", { maxTurns: 8 }),
      }),
      stored(3, {
        type: "node.started",
        id: "b",
        nodeType: "agent.worker",
        round: 2,
      }),
    ];
    const [a, b, c] = treeWithEnds(
      [
        node("a", { now: "raw text" }),
        node("b", { state: "running" }),
        node("c"),
      ],
      events,
    );
    expect(a?.end?.kind).toBe("rate_limited");
    expect(a?.now).toBe("was asked by its provider to slow down");
    expect(b?.end).toBeUndefined();
    expect(c?.end).toBeUndefined();
  });

  it("reaches a node's children", () => {
    const [root] = treeWithEnds(
      [node("lead", { children: [node("kid")] })],
      [
        stored(1, {
          type: "node.finished",
          id: "kid",
          round: 1,
          ok: false,
          output: {},
          end: endFor("interrupted"),
        }),
      ],
    );
    expect(root?.children[0]?.end?.actor).toBe("user");
  });
});
