/**
 * @file The pure helpers behind `ork __onboard finish`'s "look at" list: which
 *   removed fields it names and how a deleted node collapses to one line
 *   (specs/cli/onboard-verbs.md#finish).
 */

import { describe, expect, it } from "vitest";

import {
  collapseRemovedNodes,
  removedItems,
} from "../src/onboard/finish-checks.ts";

// JSON.stringify leaves backticks as they are, so a value can hold the phrase.
const TRICKY = `node a changes \`x\` to \`${JSON.stringify("b changes `y` to c")}\``;

describe("removedItems", () => {
  it("never reads into a field's value", () => {
    // The old pattern matched up to the last " changes `…` to " in the item.
    expect(/^(.* changes `[^`]+`) to /u.exec(TRICKY)?.[1]).toBe(
      'node a changes `x` to `"b changes `y`',
    );
    expect(removedItems([], [TRICKY])).toEqual(["node a removes `x`"]);
  });

  it("keeps a field that is still set, whatever its value", () => {
    expect(removedItems(["node a changes `x` to `2`"], [TRICKY])).toEqual([]);
  });
});

describe("collapseRemovedNodes", () => {
  const removed = [
    "node a removes `isolation`",
    "node a removes `tools.only`",
    "node b removes `context`",
  ];

  it("gives one line for a deleted node, and keeps a surviving node's", () => {
    expect(collapseRemovedNodes(removed, ["a"])).toEqual([
      "node b removes `context`",
      "node a removed",
    ]);
  });

  it("gives no line for a deleted node with no listed field", () => {
    expect(collapseRemovedNodes(removed, ["c"])).toEqual(removed);
  });
});
