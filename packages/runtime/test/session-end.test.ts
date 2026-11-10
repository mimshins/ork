/**
 * @file How each driver's decoder ends a session
 *   (specs/runtime/session-ends.md) and how the runner settles it: Claude
 *   Code's subtypes and API errors, OpenCode's step cap, error lines and exit
 *   130, Command Code's exit codes, and a report deciding over a decoder's
 *   guess.
 */

import type {
  NodeReport,
  RuntimeEvent,
  SessionOutcome,
  SessionSpec,
} from "@krapht/ork-core";
import { describe, expect, it } from "vitest";

import { openCodeDecoder } from "../src/adapters/open-code-events.ts";
import { commandCodeDecoder, outcomeOf, settleEnd } from "../src/index.ts";

const finished = (events: readonly RuntimeEvent[]): SessionOutcome => {
  const last = events.at(-1);
  if (last?.type !== "session.finished") throw new Error("no end");
  return last.outcome;
};

const spec: SessionSpec = {
  nodeId: "n",
  cwd: "/w",
  prompt: "Do it",
  systemAppend: "",
  settingSources: [],
  tools: { allow: [], deny: [] },
  permissionMode: "default",
  maxTurns: 2,
  reportSchema: {},
};

const RAW = { status: "pass", summary: "done", artifacts: {} } as const;
const PASS: NodeReport = { ...RAW, fields: {} };

describe("the claude-code decoder's end", () => {
  it.each([
    [{ subtype: "error_max_turns" }, "turn_limit"],
    [{ subtype: "error_max_budget_usd" }, "budget_limit"],
    [{ subtype: "error_max_structured_output_retries" }, "invalid_report"],
    [
      { subtype: "success", is_error: true, result: "API Error: 429 {}" },
      "rate_limited",
    ],
    [
      { subtype: "error_during_execution", errors: ["something odd"] },
      "unknown",
    ],
    [{ subtype: "success", result: "no report here" }, "no_report"],
    [{ subtype: "success", structured_output: RAW }, "done"],
    [
      { subtype: "success", structured_output: { ...RAW, status: "fail" } },
      "reported_failure",
    ],
  ])("reads %j as %s", (result, kind) => {
    expect(outcomeOf({ type: "result", ...result }).end?.kind).toBe(kind);
  });
});

/** An OpenCode leg that used `steps` steps and exited with `code`. */
const openCodeLeg = (
  steps: number,
  code: number,
  lines: readonly object[] = [],
): SessionOutcome => {
  const decoder = openCodeDecoder(spec);
  const step = { type: "step_finish", sessionID: "s", part: { cost: 0 } };
  for (const line of [...Array.from({ length: steps }, () => step), ...lines]) {
    decoder.decode(JSON.stringify(line));
  }
  return finished(decoder.exit(code));
};

describe("the open-code decoder's end", () => {
  it("reads a session that used every step and said nothing as its turn limit", () => {
    expect(openCodeLeg(2, 0).end?.kind).toBe("turn_limit");
  });

  it("reads one that stopped short of the cap as no report", () => {
    expect(openCodeLeg(1, 0).end?.kind).toBe("no_report");
  });

  it("reads exit 130 as interrupted", () => {
    expect(openCodeLeg(1, 130).end?.kind).toBe("interrupted");
  });

  it("reads an error line through the provider classifier", () => {
    const error = {
      type: "error",
      error: {
        name: "APIError",
        data: { message: "Overloaded", statusCode: 529 },
      },
    };
    expect(openCodeLeg(1, 1, [error]).end).toMatchObject({
      kind: "provider_unavailable",
      detail: "APIError\nOverloaded",
    });
  });
});

/** A Command Code leg that printed `result`, if any, and exited with `code`. */
const leg = (code: number, result?: object): SessionOutcome => {
  const decoder = commandCodeDecoder();
  if (result !== undefined) decoder.decode(JSON.stringify(result));
  return finished(decoder.exit(code));
};

describe("the command-code decoder's end", () => {
  it.each([
    [3, "auth"],
    [4, "auth"],
    [5, "rate_limited"],
    [6, "provider_unavailable"],
    [7, "provider_unavailable"],
    [8, "turn_limit"],
    [9, "provider_unavailable"],
    [10, "out_of_credits"],
    [130, "interrupted"],
  ])("reads exit %s as %s", (code, kind) => {
    const result = { type: "result", subtype: "error", error: "x" };
    expect(leg(code, result).end?.kind).toBe(kind);
  });

  it("reads exit 1 by its error's words", () => {
    const result = {
      type: "result",
      subtype: "error",
      error: "Credit balance is too low",
    };
    expect(leg(1, result).end?.kind).toBe("out_of_credits");
  });

  it("reads a known exit code with no result line", () => {
    expect(leg(3).end?.kind).toBe("auth");
  });

  it("leaves an unknown exit with no result line to stderr", () => {
    const decoder = commandCodeDecoder();
    expect(decoder.exit(2)).toEqual([]);
  });

  it("reads a clean end as no report, for the report tool to settle", () => {
    expect(leg(0, { type: "result", subtype: "success" }).end?.kind).toBe(
      "no_report",
    );
  });
});

/** An outcome with `end` and `report`. */
const outcome = (
  end: SessionOutcome["end"],
  report: NodeReport | null,
): SessionOutcome => ({
  subtype: "success",
  ...(end === undefined ? {} : { end }),
  sessionId: "s",
  report,
  text: "",
  usage: {
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    turns: 0,
    durationMs: 0,
  },
  errors: [],
});

describe("settleEnd", () => {
  it("lets a report handed in through Ork's tool decide over the decoder's guess", () => {
    const guessed = { kind: "turn_limit" as const, message: "" };
    expect(settleEnd(outcome(guessed, PASS), {}).end?.kind).toBe("done");
  });

  it("writes the message with the node's numbers", () => {
    const capped = { kind: "turn_limit" as const, message: "" };
    expect(settleEnd(outcome(capped, null), { maxTurns: 8 }).end?.message).toBe(
      "reached its turn limit (8)",
    );
  });

  it("scrubs the detail with the feedback redactor", () => {
    const failed = {
      kind: "unknown" as const,
      message: "",
      detail: "broke in /home/me/x",
    };
    const { end } = settleEnd(
      outcome(failed, null),
      {},
      { roots: [], home: "/home/me" },
    );
    expect(end?.detail).toBe("broke in ~/x");
  });

  it("reads an end for a decoder that sets none", () => {
    expect(settleEnd(outcome(undefined, null), {}).end?.kind).toBe("no_report");
  });
});
