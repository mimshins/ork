/**
 * @file The closed set of end kinds: every kind has its registry entry, ends
 *   are built with their detail scrubbed and capped, and runs stored before
 *   ends existed are read back to a kind from the text they kept.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  END_DETAIL_LIMIT,
  END_DOCS,
  END_KIND_IDS,
  END_KINDS,
  endFor,
  endOf,
  type EndKind,
  type EndKindInfo,
  outcomeEnd,
  type SessionOutcome,
} from "../src/index.ts";
import { finishedEvent } from "../src/run/results.ts";

const usage = {
  costUsd: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  turns: 0,
  durationMs: 0,
};

const failed = (error: string, output: Record<string, unknown> = {}) =>
  endOf({ ok: false, error, output: { status: "fail", ...output } }).kind;

const outcome = (over: Partial<SessionOutcome>): SessionOutcome => ({
  subtype: "success",
  sessionId: "s1",
  report: null,
  text: "",
  usage,
  errors: [],
  ...over,
});

const report = (status: "pass" | "fail") => ({
  status,
  summary: "s",
  artifacts: {},
  fields: {},
});

const incomplete = (entry: EndKindInfo): boolean =>
  entry.label === "" || entry.docsAnchor === "";

const unowned = (entry: EndKindInfo): boolean =>
  entry.actor === null || entry.hint === "";

/** The guide's sections by anchor: each `## ` heading's slug, and its text. */
const guideSections = (
  text = readFileSync(new URL(`../../../${END_DOCS}`, import.meta.url), "utf8"),
): Map<string, string> =>
  new Map(
    text
      .split(/^## /mu)
      .slice(1)
      .map(part => {
        const [heading = "", ...rest] = part.split("\n");
        return [
          heading.toLowerCase().replaceAll(" ", "-"),
          rest.join("\n"),
        ] as const;
      }),
  );

const saysWhoActs = (body: string): boolean => {
  const flat = body.replaceAll(/\s+/gu, " ");
  return flat.includes("**Who acts:**") && flat.includes("**What to do:**");
};

/** The anchors of failure kinds whose section lacks who acts or what to do. */
const silentKinds = (sections: Map<string, string>): string[] =>
  END_KIND_IDS.filter(kind => kind !== "done")
    .map(kind => END_KINDS[kind].docsAnchor)
    .filter(anchor => !saysWhoActs(sections.get(anchor) ?? ""));

const retries = (hint: string): boolean =>
  hint.includes("may pass") && hint.includes("ork resume");

describe("the end kinds", () => {
  it("has a registry entry for every kind, and no other", () => {
    expect(Object.keys(END_KINDS).toSorted()).toEqual(
      [...END_KIND_IDS].toSorted(),
    );
  });

  it("gives every kind a label and docs anchor, and every failure an actor and hint", () => {
    const failures = END_KIND_IDS.filter(kind => kind !== "done");
    expect(END_KIND_IDS.filter(kind => incomplete(END_KINDS[kind]))).toEqual(
      [],
    );
    expect(failures.filter(kind => unowned(END_KINDS[kind]))).toEqual([]);
    expect(END_KINDS.done.actor).toBeNull();
  });

  it("marks only the plan's transient kinds, and only plan_limit stops the run", () => {
    const transient = END_KIND_IDS.filter(k => END_KINDS[k].transient);
    const stops = END_KIND_IDS.filter(k => END_KINDS[k].stopsRun);
    expect(transient).toEqual([
      "plan_limit",
      "rate_limited",
      "provider_unavailable",
    ]);
    expect(stops).toEqual(["plan_limit"]);
  });

  it("says a transient kind may pass and that ork resume retries", () => {
    const hints = END_KIND_IDS.filter(k => END_KINDS[k].transient).map(
      k => END_KINDS[k].hint,
    );
    expect(hints.filter(h => !retries(h))).toEqual([]);
  });

  it("gives every kind its own section of END_DOCS, saying who acts and what to do", () => {
    const anchors = END_KIND_IDS.map(kind => END_KINDS[kind].docsAnchor);
    expect(END_DOCS).toBe("docs/guides/why-a-node-stopped.md");
    expect(new Set(anchors).size).toBe(END_KIND_IDS.length);
    const sections = guideSections();
    expect(anchors.filter(anchor => !sections.has(anchor))).toEqual([]);
    expect(silentKinds(sections)).toEqual([]);
  });

  it("finds a kind that has no section in the guide", () => {
    const text = "## Done\n\nNobody acts.\n";
    expect([...guideSections(text).keys()]).toEqual(["done"]);
    expect(guideSections(text).has("turn-limit")).toBe(false);
  });
});

describe("endFor", () => {
  it("writes Ork's sentence with the node's numbers", () => {
    expect(endFor("turn_limit", { maxTurns: 8 }).message).toBe(
      "reached its turn limit (8)",
    );
    expect(endFor("budget_limit", { budgetUsd: 0.5 }).message).toBe(
      "reached its budget ($0.50)",
    );
    expect(
      endFor("command_failed", { program: "sh", exitCode: 2 }).message,
    ).toBe("sh exited with 2");
  });

  it("leaves the detail out when there is none", () => {
    expect(endFor("unknown", {}, "  ")).toEqual({
      kind: "unknown",
      message: END_KINDS.unknown.message({}),
    });
  });

  it("masks secrets and caps the detail", () => {
    const end = endFor(
      "auth",
      {},
      `key sk-ant-api03-${"a".repeat(40)} ${"x".repeat(END_DETAIL_LIMIT)}`,
    );
    expect(end.detail).not.toContain("sk-ant-api03-aaaa");
    expect(end.detail).toHaveLength(END_DETAIL_LIMIT);
  });

  it("scrubs the detail with the feedback redactor when given its roots", () => {
    const end = endFor("driver_crashed", {}, "failed in /work/repo/src", {
      roots: ["/work/repo"],
      home: "/home/me",
    });
    expect(end.detail).toBe("failed in <project>/src");
  });
});

describe("endOf over runs stored before ends", () => {
  it("returns a stored end as it is", () => {
    const end = endFor("rate_limited");
    expect(endOf({ ok: false, output: {}, error: "x", end })).toBe(end);
  });

  it("reads a finished node as done", () => {
    expect(endOf({ ok: true, output: { status: "pass" } })).toEqual({
      kind: "done",
      message: "finished",
    });
  });

  it("keeps the stored error as the detail", () => {
    expect(
      endOf({ ok: false, output: {}, error: "sh exited with 1: no" }),
    ).toEqual({
      kind: "command_failed",
      message: "its command exited with an error",
      detail: "sh exited with 1: no",
    });
  });

  // Real `error` strings from stored runs, kept as Ork wrote them.
  const STORED: readonly (readonly [string, EndKind])[] = [
    [
      "ended without a report (error_max_turns): Reached maximum number of turns (80)",
      "turn_limit",
    ],
    ["ended without a report (error_max_turns): no valid report", "turn_limit"],
    ["ended without a report (success): no valid report", "no_report"],
    [
      "ended without a report (error_during_execution): no valid report",
      "no_report",
    ],
    [
      "ended without a report (error_max_budget_usd): Reached maximum budget ($2)",
      "budget_limit",
    ],
    [
      'ended without a report (error_during_execution): {"type":"error","error":{"type":"invalid_request_error","message":"This model does not support assistant message prefill. The conversation must end with a user message."}}',
      "model_unavailable",
    ],
    [
      'ended without a report (error_during_execution): {"type":"error","error":{"type":"invalid_request_error","message":"messages.1.content.0: Invalid `signature` in `thinking` block. The block is bound to a different conversation."}}',
      "model_unavailable",
    ],
    [
      'ended without a report (error_during_execution): {"type":"error","error":{"type":"rate_limit_error","message":"Number of request tokens has exceeded your per-minute rate limit"}}',
      "rate_limited",
    ],
    [
      'ended without a report (error_during_execution): {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
      "provider_unavailable",
    ],
    [
      'ended without a report (error_during_execution): {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
      "auth",
    ],
    [
      "ended without a report (error_during_execution): Your credit balance is too low to access the Anthropic API.",
      "out_of_credits",
    ],
    [
      "ended without a report (error_during_execution): prompt is too long: 210000 tokens > 200000 maximum",
      "context_too_long",
    ],
    [
      "ended without a report (error_during_execution): [ede_diagnostic] result_type=user last_content_type=n/a stop_reason=tool_use",
      "unknown",
    ],
    [
      'ended without a report (error_driver): Error: --json-schema is not a valid JSON Schema: strict mode: unknown keyword: "list"',
      "driver_crashed",
    ],
    [
      "ended without a report (error_driver): spawn opencode ENOENT",
      "tool_missing",
    ],
    ["the session ended without a result", "driver_crashed"],
    ["not started: nothing is left of the run's budget", "budget_limit"],
    ["not started: no agent driver is ready; see `ork doctor`", "tool_missing"],
    [
      "not started: your Claude plan's five hour limit was reached; it resets on 10 Nov, 14:00",
      "plan_limit",
    ],
    [
      "not started: your daily quota of $20 is spent ($21.40); it lifts on 11 Nov, or raise it in ~/.ork/settings.yaml",
      "plan_limit",
    ],
    ["timed out after 10m", "timed_out"],
    ["no one answered the gate", "timed_out"],
    ["the gate was withdrawn", "interrupted"],
    ["stopped by the user", "interrupted"],
    ["the node was stopped", "interrupted"],
    ["git add failed: remove the file manually to continue.", "command_failed"],
    ["git reset failed: spawn git ENOENT", "tool_missing"],
    [
      "git worktree failed: fatal: '/w/ork-engine' already exists",
      "command_failed",
    ],
    [
      "sh exited with 1: error: specs/gaps.md: patch does not apply",
      "command_failed",
    ],
    [
      "sh exited with 141: $ tsc -p docs/interaction-map && node docs/interaction-map/tools/check.mjs",
      "command_failed",
    ],
    ["fetch: $ORK_OUTPUT is empty", "invalid_output"],
    [
      "Run d67e4060 ended budget_exhausted: the run's budget of $35 is spent",
      "budget_limit",
    ],
    ["Run c1a569ed ended interrupted: the run was interrupted", "interrupted"],
    [
      "Run 8e08b70e ended failed: publish: sh exited with 141: $ tsc -p docs",
      "command_failed",
    ],
    ["unknown node review", "unknown"],
  ];

  it.each(STORED)("reads %j as %s", (error, kind) => {
    expect(failed(error)).toBe(kind);
  });

  it("reads a failed report as the agent's, whatever its summary says", () => {
    const summary =
      "Blocked, no work done. shell_command refused, timed out after 10m";
    expect(failed(summary, { summary, artifacts: {} })).toBe(
      "reported_failure",
    );
  });

  it("reads a report that broke its declared output as invalid_report", () => {
    const problem = "verdict is missing, expected one of pass, fail";
    expect(failed(problem, { summary: problem, artifacts: {} })).toBe(
      "invalid_report",
    );
  });
});

describe("outcomeEnd", () => {
  it("returns the outcome's own end", () => {
    const end = endFor("turn_limit", { maxTurns: 3 });
    expect(outcomeEnd(outcome({ end, subtype: "success" }))).toBe(end);
  });

  it.each([
    [outcome({ report: report("pass") }), "done"],
    [outcome({ report: report("fail") }), "reported_failure"],
    [outcome({}), "no_report"],
    [outcome({ subtype: "error_max_turns" }), "turn_limit"],
    [outcome({ subtype: "error_max_budget_usd" }), "budget_limit"],
    [outcome({ subtype: "error_driver", errors: ["boom"] }), "driver_crashed"],
    [
      outcome({
        subtype: "error_during_execution",
        errors: ['{"error":{"type":"overloaded_error"}}'],
      }),
      "provider_unavailable",
    ],
  ] as const)("reads a stored outcome as %#: %s", (stored, kind) => {
    expect(outcomeEnd(stored).kind).toBe(kind);
  });
});

describe("node.finished", () => {
  it("carries the result's end", () => {
    const end = endFor("timed_out", { timeout: "5m" });
    expect(
      finishedEvent("a", 1, { ok: false, output: {}, error: end.message, end }),
    ).toMatchObject({ type: "node.finished", end });
  });
});
