/**
 * @file Tests for the integration and driver registries: ids are unique and
 *   consistent, and adapters build their own arguments.
 */

import { describe, expect, it } from "vitest";

import {
  aws,
  CLAUDE_DRIVERS,
  DRIVER_IDS,
  git,
  INTEGRATIONS,
  integrationFor,
  MIN_CLAUDE_VERSION,
  olderThan,
} from "../src/index.ts";

describe("the registries", () => {
  it("have unique ids, and the driver ids match the descriptors", () => {
    const ids = INTEGRATIONS.map(i => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(CLAUDE_DRIVERS.map(d => d.id)).toEqual([...DRIVER_IDS]);
  });

  it("find the integration behind a node type", () => {
    expect(integrationFor("tool.aws")).toBe(aws);
    expect(integrationFor("tool.git")).toBe(git);
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

  it("let an adapter set a default allow list: git adds and commits, never pushes", () => {
    expect(git.allow).toEqual(["add", "commit"]);
    expect(aws.allow).toBeUndefined();
  });
});

describe("the claude version check", () => {
  it("compares `claude --version` output with the minimum", () => {
    expect(olderThan("2.1.280 (Claude Code)", MIN_CLAUDE_VERSION)).toBe(true);
    expect(olderThan("2.1.281 (Claude Code)", MIN_CLAUDE_VERSION)).toBe(false);
    expect(olderThan("2.2.0 (Claude Code)", MIN_CLAUDE_VERSION)).toBe(false);
    expect(olderThan("unknown", MIN_CLAUDE_VERSION)).toBe(false);
  });
});
