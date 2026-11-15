/**
 * @file Tests that a parked prompt is withdrawn by its signal, including one
 *   already aborted before it parks, which `ork decide --follow` relies on to
 *   end the prompt that took a Ctrl-C.
 */

import { describe, expect, it } from "vitest";

import { parked } from "../src/human.ts";

describe("a parked prompt", () => {
  it("is withdrawn when its signal aborts", async () => {
    const stop = new AbortController();
    const waiting = parked(stop.signal);
    stop.abort(new Error("answered elsewhere"));
    await expect(waiting).rejects.toThrow(/answered elsewhere/u);
  });

  it("is withdrawn at once by a signal already aborted", async () => {
    await expect(
      parked(AbortSignal.abort(new Error("answered elsewhere"))),
    ).rejects.toThrow(/answered elsewhere/u);
  });
});
