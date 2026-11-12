/**
 * @file Tests for how a node's end reads on the terminal (specs/runtime/
 *   session-ends.md): Ork's message and the kind's label, a note for a kind
 *   that may pass, the setup hint for an account or provider end, the scrubbed
 *   detail only with `--verbose` or one node's log, and old runs read through
 *   `endOf`, in `ork run`, `ork run --node` and `ork logs`.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  type AgentRuntime,
  endFor,
  openStore,
  type RunEvent,
  type SessionOutcome,
} from "@krapht/ork-core";
import { describe, expect, it } from "vitest";

import { createLogPrinter, formatRunEvent, runNode } from "../src/index.ts";
import { readyOnly } from "./fixtures/drivers.ts";

/** Colors off: lines compare as plain text. */
const plain = (line: string): string =>
  // oxlint-disable-next-line no-control-regex -- strips the terminal's escape codes
  line.replaceAll(/\u001B\[[0-9;]*m/gu, "");

const RAW = '{"type":"error","error":{"type":"overloaded_error"}} secret-body';

const finished = (
  end: ReturnType<typeof endFor> | undefined,
  verbose: boolean,
  fields: { error?: string; output?: Record<string, unknown> } = {},
): string[] =>
  formatRunEvent(
    {
      type: "node.finished",
      id: "w",
      round: 1,
      ok: false,
      output: fields.output ?? { status: "fail", summary: "x" },
      ...(fields.error === undefined ? {} : { error: fields.error }),
      ...(end === undefined ? {} : { end }),
    },
    4,
    new Map(),
    false,
    verbose,
  ).map(line => plain(line));

const started = (extra: { description?: string }): string[] =>
  formatRunEvent(
    {
      type: "node.started",
      id: "w",
      nodeType: "agent.worker",
      round: 1,
      ...extra,
    },
    4,
    new Map(),
  ).map(line => plain(line));

describe("a node's start line in the transcript", () => {
  it("shows the task's description after the node's type", () => {
    expect(started({ description: "fix the parser" })).toEqual([
      "w    │ agent.worker · fix the parser",
    ]);
  });

  it("is the same as before without one", () => {
    expect(started({})).toEqual(["w    │ agent.worker"]);
  });
});

describe("a failed node's end in the transcript", () => {
  it("says the kind and Ork's message, never the raw text", () => {
    const end = endFor("turn_limit", { maxTurns: 8 }, RAW);
    expect(finished(end, false)).toEqual([
      "w    │ ✗ Turn limit: reached its turn limit (8)",
    ]);
  });

  it("says a transient kind may pass and resume retries, once", () => {
    const end = endFor("rate_limited", {}, RAW);
    expect(finished(end, true).slice(0, 1)).toEqual([
      "w    │ ✗ Rate limited: was asked by its provider to slow down (may pass; ork resume retries)",
    ]);
    expect(finished(end, true).join("\n")).not.toContain("tries again");
  });

  it("shows the setup hint of an account end without --verbose", () => {
    const end = endFor("out_of_credits", {}, RAW);
    expect(finished(end, false)).toEqual([
      "w    │ ✗ Out of credits: found no credit left on its account",
      "w    │   Add credit to the account, or use another, then `ork resume`.",
    ]);
  });

  it("keeps the hint of a workflow end behind --verbose", () => {
    const end = endFor("timed_out", { timeout: "10m" });
    expect(finished(end, false)).toHaveLength(1);
    expect(finished(end, true)[1]).toContain("Raise its `timeout`");
  });

  it("adds the detail only with --verbose", () => {
    const end = endFor("provider_unavailable", {}, RAW);
    expect(finished(end, false).join("\n")).not.toContain("overloaded_error");
    expect(finished(end, true).join("\n")).toContain("overloaded_error");
  });

  it("shows a failed tool's last stderr line without --verbose, cut to 200", () => {
    const stderr = `starting\n${"x".repeat(300)}\nno such issue: #12\n\n`;
    const end = endFor(
      "command_failed",
      { program: "sh", exitCode: 1 },
      stderr,
    );
    expect(finished(end, false)).toEqual([
      "w    │ ✗ Command failed: sh exited with 1",
      "w    │   no such issue: #12",
    ]);
    const long = endFor("command_failed", {}, `${"y".repeat(300)}\n`);
    expect(finished(long, false)[1]).toBe(`w    │   ${"y".repeat(200)}`);
  });

  it("shows no line for a failed tool with no stderr", () => {
    const end = endFor("command_failed", { program: "sh", exitCode: 1 });
    expect(finished(end, false)).toHaveLength(1);
  });

  it("keeps the agent's own summary for a failure it reported", () => {
    const end = endFor("reported_failure");
    expect(
      finished(end, false, {
        output: { status: "fail", summary: "tests broke" },
      }),
    ).toEqual(["w    │ ✗ fail: tests broke"]);
  });

  it("reads an old run's stored error through the legacy map", () => {
    expect(
      finished(undefined, false, {
        error: "ended without a report (error_max_turns): no valid report",
      }),
    ).toEqual(["w    │ ✗ Turn limit: reached its turn limit"]);
  });

  it("keeps an old run's text no rule reads", () => {
    expect(
      finished(undefined, false, {
        error: "something odd happened",
        output: { status: "pass", summary: "done" },
      }),
    ).toEqual(["w    │ ✗ fail: something odd happened"]);
  });
});

const stored = (verbose: boolean, node?: string): string[] => {
  const print = createLogPrinter({
    json: false,
    verbose,
    ...(node === undefined ? {} : { node }),
  });
  const event: RunEvent = {
    type: "node.finished",
    id: "w",
    round: 1,
    ok: false,
    output: { status: "fail", summary: "x" },
    end: endFor("provider_unavailable", {}, RAW),
  };
  return print({ seq: 1, runId: "r", at: "", event }).map(line => plain(line));
};

describe("ork logs", () => {
  it("hides the detail in a whole run's log", () => {
    expect(stored(false).join("\n")).not.toContain("overloaded_error");
  });

  it("shows the detail with --verbose, and for one node", () => {
    expect(stored(true).join("\n")).toContain("overloaded_error");
    expect(stored(false, "w").join("\n")).toContain("overloaded_error");
  });
});

const outcomeOf = (end: ReturnType<typeof endFor>): SessionOutcome => ({
  subtype: "error_max_turns",
  end,
  sessionId: "s1",
  report: null,
  text: "",
  usage: {
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    turns: 8,
    durationMs: 0,
  },
  errors: [RAW],
});

/** A runtime whose one session ends as `outcome`. */
const endingAs = (outcome: SessionOutcome): AgentRuntime => ({
  driver: "claude-code",
  start: () => ({
    events: (async function* () {
      await Promise.resolve();
      yield { type: "session.finished", outcome } as const;
    })(),
    send: () => {},
    interrupt: () => Promise.resolve(),
  }),
});

/** What the recorded events say of how the node and the run ended. */
const recordedEnds = (events: readonly RunEvent[]) => {
  const node = events.flatMap(e => (e.type === "node.finished" ? [e] : []));
  const run = events.flatMap(e => (e.type === "run.finished" ? [e] : []));
  return {
    node: node.map(e => e.end?.kind),
    summary: run.map(e => e.result.nodes[0]?.end?.kind),
    reasons: run.map(e => e.result.reasons),
  };
};

const runEnding = async (outcome: SessionOutcome, verbose: boolean) => {
  const cwd = mkdtempSync(path.join(tmpdir(), "ork-ends-"));
  mkdirSync(cwd, { recursive: true });
  writeFileSync(
    path.join(cwd, "w.ork.yaml"),
    [
      "schemaVersion: 1",
      "name: w",
      "nodes:",
      "  worker:",
      "    type: agent.worker",
      "    model: haiku",
      "    isolation: readonly",
      '    prompt: "Go"',
      "",
    ].join("\n"),
  );
  const out: string[] = [];
  const store = openStore(":memory:");
  const done = await runNode({
    file: "w.ork.yaml",
    cwd,
    nodeId: "worker",
    inputs: [],
    inPlace: true,
    json: false,
    verbose,
    runtime: () => Promise.resolve(endingAs(outcome)),
    // Not the machine's own `claude`: CI has none.
    driverChecks: readyOnly("claude-code"),
    store,
    home: mkdtempSync(path.join(tmpdir(), "ork-home-")),
    out: line => {
      out.push(plain(line));
    },
    err: () => {},
  });
  const runs = store.runs();
  const events = store.events(runs[0]?.id ?? "").map(s => s.event);
  return { out, done, events };
};

describe("ork run --node", () => {
  const turnLimit = outcomeOf(endFor("turn_limit", { maxTurns: 8 }, RAW));

  it("prints the kind and message, not the driver's raw errors", async () => {
    const { out, done } = await runEnding(turnLimit, false);
    expect(done.exitCode).toBe(1);
    expect(out.join("\n")).toContain(
      "✗ worker Turn limit: reached its turn limit (8)",
    );
    expect(out.join("\n")).not.toContain("overloaded_error");
  });

  it("prints the detail with --verbose", async () => {
    const { out } = await runEnding(turnLimit, true);
    expect(out.join("\n")).toContain("overloaded_error");
  });

  it("records the end on node.finished and in the run summary", async () => {
    const { events } = await runEnding(turnLimit, false);
    expect(recordedEnds(events)).toEqual({
      node: ["turn_limit"],
      summary: ["turn_limit"],
      reasons: [["worker: reached its turn limit (8)"]],
    });
  });
});
