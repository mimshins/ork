/** @file Tests for what `ork relay`'s words mean, and how a link reads. */

import type { LinkRecord } from "@krapht/ork-core";
import { describe, expect, it } from "vitest";

import { formatLink, maxMessagesOf, relayAction } from "../src/index.ts";

describe("relayAction", () => {
  it.each([
    [["a/x", "b/y", undefined], { kind: "link", a: "a/x", b: "b/y" }],
    [["end", "a/x", "b/y"], { kind: "end", a: "a/x", b: "b/y" }],
    [["list", undefined, undefined], { kind: "list" }],
    [["list", "a1", undefined], { kind: "list", run: "a1" }],
    [[undefined, undefined, undefined], { kind: "usage" }],
    [["a/x", undefined, undefined], { kind: "usage" }],
    [["end", "a/x", undefined], { kind: "usage" }],
  ] as const)("reads %j", (words, action) => {
    expect(relayAction(words[0], words[1], words[2])).toEqual(action);
  });
});

describe("maxMessagesOf", () => {
  it("takes a whole number above zero", () => {
    expect(maxMessagesOf("5")).toBe(5);
  });

  it.each(["0", "-1", "1.5", "lots"])("refuses %s", given => {
    expect(maxMessagesOf(given)).toBeNull();
  });

  it("is nothing when not given", () => {
    expect(maxMessagesOf()).toBeUndefined();
  });
});

describe("formatLink", () => {
  const link: LinkRecord = {
    id: 1,
    a: { run: "a1", node: "x" },
    b: { run: "b2", node: "y" },
    messages: 3,
    maxMessages: 100,
    createdAt: "2026-11-03T00:00:00.000Z",
  };

  it("names both ends and the count", () => {
    expect(formatLink(link)).toBe("a1/x <-> b2/y  3/100 messages");
  });

  it("says when it has ended", () => {
    expect(formatLink({ ...link, endedAt: "2026-11-03" })).toContain("(ended)");
  });
});
