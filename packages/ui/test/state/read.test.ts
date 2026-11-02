/**
 * @file Tests for a one-off read: its states, and that when reads overlap the
 *   newest wins, whichever answers last.
 */

import type { CallResult } from "@krapht/ork-server/client";
import { describe, expect, it } from "vitest";

import { createRead } from "../../src/state/read.ts";

const ok = (data: string): CallResult<string> => ({
  ok: true,
  status: 200,
  data,
});

describe("a one-off read", () => {
  it("goes from idle through loading to its answer", async () => {
    const read = createRead(() => Promise.resolve(ok("answer")));
    expect(read.state.getValue()).toEqual({ status: "idle" });
    const loading = read.load();
    expect(read.state.getValue().status).toBe("loading");
    await loading;
    expect(read.state.getValue()).toMatchObject({
      status: "ready",
      data: "answer",
    });
  });

  it("holds the reason when the read fails", async () => {
    const read = createRead(() =>
      Promise.resolve<CallResult<string>>({
        ok: false,
        status: 500,
        error: "Refused.",
      }),
    );
    await read.load();
    expect(read.state.getValue()).toMatchObject({
      status: "failed",
      error: "Refused.",
    });
  });

  it("keeps the newest read's answer when an older one lands later", async () => {
    const finish: Record<string, (answer: CallResult<string>) => void> = {};
    const read = createRead(
      (id: string) =>
        new Promise<CallResult<string>>(resolve => {
          finish[id] = resolve;
        }),
    );
    const older = read.load("older");
    const newer = read.load("newer");
    finish["newer"]?.(ok("newer answer"));
    await newer;
    finish["older"]?.(ok("older answer"));
    await older;
    expect(read.state.getValue()).toMatchObject({
      arg: "newer",
      data: "newer answer",
    });
  });
});
