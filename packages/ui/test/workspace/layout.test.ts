/**
 * @file Tests for the layout a browser remembers: what is trusted, what is
 *   dropped as damaged or from another version, and that it lasts in storage.
 */

import { describe, expect, it } from "vitest";

import {
  createLayoutStore,
  EMPTY_LAYOUT,
  readLayout,
  withFold,
} from "../../src/workspace/layout.ts";

const anchor = { group: "1", index: 0 };

const dockWith = (component: string) => ({
  grid: { root: {}, width: 1, height: 1, orientation: "HORIZONTAL" },
  panels: { one: { id: "one", contentComponent: component } },
});

describe("reading a saved layout", () => {
  it("takes the empty layout", () => {
    expect(readLayout(EMPTY_LAYOUT)).toEqual(EMPTY_LAYOUT);
  });

  it("takes a dock of known panels", () => {
    const saved = { dock: dockWith("logs"), minimized: [], folded: ["runs"] };
    expect(readLayout(saved)?.folded).toEqual(["runs"]);
  });

  it.each([
    ["not a layout", "nonsense"],
    ["nothing", null],
    ["a missing list", { dock: null }],
    ["an unknown panel in the dock", { ...EMPTY_LAYOUT, dock: dockWith("x") }],
    ["a broken dock", { ...EMPTY_LAYOUT, dock: { grid: 1 } }],
    [
      "an unknown panel on the rail",
      { ...EMPTY_LAYOUT, minimized: [{ id: "x", anchor }] },
    ],
    ["an unknown folded panel", { ...EMPTY_LAYOUT, folded: ["x"] }],
  ])("drops %s", (_, saved) => {
    expect(readLayout(saved)).toBeNull();
  });

  it("keeps a panel that is in both the dock and the rail in the dock", () => {
    const saved = {
      dock: dockWith("logs"),
      minimized: [
        { id: "logs", anchor },
        { id: "runs", anchor },
      ],
      folded: [],
    };
    expect(readLayout(saved)?.minimized.map(panel => panel.id)).toEqual([
      "runs",
    ]);
  });
});

describe("the folded list", () => {
  it("adds a panel once and removes it", () => {
    expect(withFold(["runs"], "logs", true)).toEqual(["runs", "logs"]);
    expect(withFold(["runs"], "runs", true)).toEqual(["runs"]);
    expect(withFold(["runs"], "runs", false)).toEqual([]);
  });
});

describe("the store", () => {
  it("lasts across stores on the same storage", async () => {
    const first = createLayoutStore(localStorage);
    await first.setValue({ ...EMPTY_LAYOUT, folded: ["logs"] });
    expect(createLayoutStore(localStorage).getValue().folded).toEqual(["logs"]);
    await first.reset();
    expect(createLayoutStore(localStorage).getValue()).toEqual(EMPTY_LAYOUT);
  });
});
