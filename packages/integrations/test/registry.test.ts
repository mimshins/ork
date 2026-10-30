/**
 * @file Tests for the integration and driver registries: ids are unique and
 *   consistent, and adapters build their own arguments.
 */

import { describe, expect, it } from "vitest";

import {
  aws,
  CLAUDE_DRIVERS,
  DRIVER_IDS,
  INTEGRATIONS,
  integrationFor,
} from "../src/index.ts";

describe("the registries", () => {
  it("have unique ids, and the driver ids match the descriptors", () => {
    const ids = INTEGRATIONS.map(i => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(CLAUDE_DRIVERS.map(d => d.id)).toEqual([...DRIVER_IDS]);
  });

  it("find the integration behind a node type", () => {
    expect(integrationFor("tool.aws")).toBe(aws);
    expect(integrationFor("tool.nope")).toBeUndefined();
    expect(integrationFor("claude.worker")).toBeUndefined();
  });

  it("let an adapter add its own arguments", () => {
    expect(aws.args({ profile: "dev", region: "eu-west-1" })).toEqual([
      "--profile",
      "dev",
      "--region",
      "eu-west-1",
    ]);
    expect(aws.args({})).toEqual([]);
  });
});
