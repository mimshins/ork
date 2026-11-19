/**
 * @file Tests for the line `ork logs` and the live stream print when the
 *   `sessions.freshOver` rule started a delegated builder in a fresh session
 *   (`node.started.fresh`), and that `--json` carries the field as stored.
 */

import { stripVTControlCharacters } from "node:util";

import type { RunEvent, StoredEvent } from "@krapht/ork-core";
import { describe, expect, it } from "vitest";

import { createLogPrinter, formatRunEvent } from "../src/index.ts";

const started = (fresh?: {
  contextTokens: number;
  over: number;
}): RunEvent => ({
  type: "node.started",
  id: "build",
  nodeType: "agent.worker",
  round: 1,
  owner: "lead",
  ...(fresh === undefined ? {} : { fresh }),
});

const lines = (event: RunEvent): string[] =>
  formatRunEvent(event, 5, new Map()).map(line =>
    stripVTControlCharacters(line),
  );

describe("node.started with `fresh`", () => {
  it("prints one more line with the context and the threshold", () => {
    const [first, second, ...rest] = lines(
      started({ contextTokens: 123456, over: 100000 }),
    );
    expect(first).toContain("agent.worker, for lead");
    expect(second).toContain(
      "starts a fresh session: context 123456 tokens over 100000",
    );
    expect(rest).toEqual([]);
  });

  it("leaves a start without it as one line", () => {
    expect(lines(started())).toHaveLength(1);
  });

  it("is carried as stored by `--json`", () => {
    const fresh = { contextTokens: 123456, over: 100000 };
    const stored: StoredEvent = {
      runId: "r1",
      seq: 1,
      at: "2026-11-19T10:00:00.000Z",
      event: started(fresh),
    };
    const printed = createLogPrinter({ json: true })(stored);
    expect(printed).toEqual([JSON.stringify(stored)]);
    expect(printed[0]).toContain(
      '"fresh":{"contextTokens":123456,"over":100000}',
    );
  });
});
