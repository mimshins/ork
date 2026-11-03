/** @file Tests for the graph's edges in words, each from both of its ends. */

import { describe, expect, it } from "vitest";

import { connectionsOf } from "../../src/graph/connections.ts";
import type { EdgeKind, PlacedEdge } from "../../src/graph/types.ts";

const edge = (
  from: string,
  to: string,
  kind: EdgeKind = "flow",
  label?: string,
): PlacedEdge => ({
  from,
  to,
  kind,
  shape: "lines",
  points: [],
  ...(label === undefined ? {} : { label }),
});

describe("a node's edges in words", () => {
  it("says what it comes after and leads to, with conditions", () => {
    const words = connectionsOf([
      edge("a", "c"),
      edge("b", "c"),
      edge("c", "d", "flow", "exitCode == 0"),
    ]);
    expect(words.get("c")).toBe("after a, b; leads to d if exitCode == 0");
    expect(words.get("d")).toBe("after c if exitCode == 0");
  });

  it("says loops, owners and channels in their own words", () => {
    const words = connectionsOf([
      edge("end", "start", "back", "again"),
      edge("lead", "kid", "owner"),
      edge("kid", "peer", "message"),
    ]);
    expect(words.get("end")).toBe("goes back to start if again");
    expect(words.get("start")).toBe("comes back from end if again");
    expect(words.get("lead")).toBe("owns kid");
    expect(words.get("kid")).toBe("owned by lead; can message peer");
    expect(words.get("peer")).toBe("can message kid");
  });

  it("has nothing to say of a node with no edges", () => {
    expect(connectionsOf([]).size).toBe(0);
  });
});
