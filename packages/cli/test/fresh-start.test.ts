/**
 * @file Tests for the line `ork logs` and the live stream print when the
 *   `sessions.freshOver` rule (`node.started.fresh`) or a changed driver
 *   (`node.started.driverChanged`) started a delegated builder in a fresh
 *   session, and that `--json` carries the fields as stored.
 */

import { stripVTControlCharacters } from "node:util";

import type { RunEvent, StoredEvent } from "@krapht/ork-core";
import type { Driver } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import { createLogPrinter, formatRunEvent } from "../src/index.ts";

const started = (
  fresh?: { contextTokens: number; over: number },
  driverChanged?: { from: Driver; to: Driver },
): RunEvent => ({
  type: "node.started",
  id: "build",
  nodeType: "agent.worker",
  round: 1,
  owner: "lead",
  ...(fresh === undefined ? {} : { fresh }),
  ...(driverChanged === undefined ? {} : { driverChanged }),
});

const change = { from: "claude-code", to: "open-code" } as const;

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

describe("node.started with `driverChanged`", () => {
  it("prints one more line naming both drivers", () => {
    const [first, second, ...rest] = lines(started(undefined, change));
    expect(first).toContain("agent.worker, for lead");
    expect(second).toContain(
      "starts a fresh session: driver changed from claude-code to open-code",
    );
    expect(rest).toEqual([]);
  });

  it("prints both lines when the context was over too", () => {
    const [, second, third, ...rest] = lines(
      started({ contextTokens: 123456, over: 100000 }, change),
    );
    expect(second).toContain("context 123456 tokens over 100000");
    expect(third).toContain("driver changed from claude-code to open-code");
    expect(rest).toEqual([]);
  });

  it("is carried as stored by `--json`", () => {
    const stored: StoredEvent = {
      runId: "r1",
      seq: 1,
      at: "2026-11-19T10:00:00.000Z",
      event: started(undefined, change),
    };
    const printed = createLogPrinter({ json: true })(stored);
    expect(printed).toEqual([JSON.stringify(stored)]);
    expect(printed[0]).toContain(
      '"driverChanged":{"from":"claude-code","to":"open-code"}',
    );
  });
});
