/**
 * @file Tests for `read_input`: a session gets it only when its sent-back input
 *   was cut, and reads all of it a page at a time.
 */

import type { HumanChannel } from "@krapht/ork-core";
import { describe, expect, it } from "vitest";

import { orkTools } from "../src/index.ts";
import { INPUT_PAGE } from "../src/tools/input.ts";

const human: HumanChannel = {
  ask: () => Promise.resolve(""),
  permit: () => Promise.resolve({ allow: true }),
};

const readInput = (input: string | null) =>
  orkTools({
    nodeId: "build",
    driver: "claude-code",
    ports: input === null ? { human } : { human, input },
  }).find(tool => tool.name === "read_input");

/** What a call says, as one string. */
const said = async (input: string, args: unknown): Promise<string> => {
  const result = await readInput(input)?.call(args);
  return result?.content.map(part => part.text).join("") ?? "";
};

describe("read_input", () => {
  it("is there only when the input was cut", () => {
    expect(readInput(null)).toBeUndefined();
    expect(readInput("{}")?.preapproved).toBe(true);
  });

  it("returns a short input whole", async () => {
    expect(await said('{"a":1}', {})).toBe(
      '{"a":1}\n\n[characters 0–7 of 7: the end]',
    );
  });

  it("reads a long input a page at a time, to its end", async () => {
    const whole = `${"a".repeat(INPUT_PAGE)}${"b".repeat(10)}`;
    const first = await said(whole, {});
    expect(first).toContain(
      `call read_input with from: ${String(INPUT_PAGE)} for the rest`,
    );
    expect(await said(whole, { from: INPUT_PAGE })).toBe(
      `${"b".repeat(10)}\n\n[characters ${String(INPUT_PAGE)}–${String(INPUT_PAGE + 10)} of ${String(INPUT_PAGE + 10)}: the end]`,
    );
  });

  it("refuses a bad start", async () => {
    const result = await readInput("{}")?.call({ from: -1 });
    expect(result?.isError).toBe(true);
  });
});
