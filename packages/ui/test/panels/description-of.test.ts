/**
 * @file Tests for `descriptionOf`: what a task called a node, read from the
 *   event that starts it.
 */

import type { StoredEvent } from "@krapht/ork-server/client";
import { describe, expect, it } from "vitest";

import { descriptionOf } from "../../src/panels/logs-model.ts";

const started = (description?: string): StoredEvent["event"] => ({
  type: "node.started",
  id: "a",
  nodeType: "agent.worker",
  round: 1,
  ...(description === undefined ? {} : { description }),
});

describe("descriptionOf", () => {
  it("is the trimmed text of a node.started that has one", () => {
    expect(descriptionOf(started("  fix login  "))).toBe("fix login");
  });

  it("is nothing for a blank one or none", () => {
    expect(descriptionOf(started("   "))).toBeUndefined();
    expect(descriptionOf(started())).toBeUndefined();
  });

  it("is nothing for another event", () => {
    expect(
      descriptionOf({ type: "edge.taken", from: "a", to: "b" }),
    ).toBeUndefined();
  });
});
