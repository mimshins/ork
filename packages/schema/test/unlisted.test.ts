/**
 * @file Tests for the `unlisted` tool rule (RFC-028): `refuse` or `ask` loads
 *   as a node's `tools.unlisted`, a workflow's `rules.permissions.unlisted` and
 *   a project's `permissions.unlisted`; it is optional, and any other word is
 *   refused.
 */

import { describe, expect, it } from "vitest";

import { parseProject, parseWorkflow } from "../src/index.ts";

const project = (value: string) =>
  parseProject(`schemaVersion: 1\npermissions:\n  unlisted: ${value}\n`);

const workflow = (value: string) =>
  parseWorkflow(
    `schemaVersion: 1\nname: x\nrules:\n  permissions:\n    unlisted: ${value}\nnodes:\n  a:\n    type: agent.worker\n    prompt: hi\n`,
  );

const node = (value: string) =>
  parseWorkflow(
    `schemaVersion: 1\nname: x\nnodes:\n  a:\n    type: agent.worker\n    prompt: hi\n    tools: { unlisted: ${value} }\n`,
  );

describe("unlisted", () => {
  it.each(["refuse", "ask"])(
    "takes %s on a project, workflow and node",
    value => {
      expect(project(value).ok).toBe(true);
      expect(workflow(value).ok).toBe(true);
      expect(node(value).ok).toBe(true);
    },
  );

  it("is optional", () => {
    expect(parseProject("schemaVersion: 1\npermissions: {}\n").ok).toBe(true);
  });

  it.each(["allow", "never", "true"])("refuses %s", value => {
    expect(project(value).ok).toBe(false);
    expect(workflow(value).ok).toBe(false);
    expect(node(value).ok).toBe(false);
  });
});
