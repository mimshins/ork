/**
 * @file Tests for the keys that keep an Ork session apart from a project's own
 *   agent process: `rules.agents`, `knowledge` (project file only) and
 *   `practices.quiet`.
 */

import { describe, expect, it } from "vitest";

import { parseProject, parseWorkflow } from "../src/index.ts";

const NODES = "nodes:\n  a:\n    type: agent.worker\n    prompt: hi\n";

describe("rules.agents", () => {
  it.each(["open", "isolate"])(
    "takes %s in a project and a workflow",
    value => {
      expect(parseProject(`schemaVersion: 1\nagents: ${value}\n`).ok).toBe(
        true,
      );
      expect(
        parseWorkflow(
          `schemaVersion: 1\nname: x\nrules:\n  agents: ${value}\n${NODES}`,
        ).ok,
      ).toBe(true);
    },
  );

  it("refuses another word", () => {
    expect(parseProject("schemaVersion: 1\nagents: all\n").ok).toBe(false);
  });
});

describe("knowledge", () => {
  it.each(["any", "ork-only"])("takes %s in a project", value => {
    expect(parseProject(`schemaVersion: 1\nknowledge: ${value}\n`).ok).toBe(
      true,
    );
  });

  it("refuses another word", () => {
    expect(parseProject("schemaVersion: 1\nknowledge: none\n").ok).toBe(false);
  });

  it("is not a workflow rule", () => {
    const text = `schemaVersion: 1\nname: x\nrules:\n  knowledge: ork-only\n${NODES}`;
    expect(parseWorkflow(text).ok).toBe(false);
  });
});

describe("practices.quiet", () => {
  it("takes a boolean in defaults and on a node", () => {
    expect(
      parseProject(
        "schemaVersion: 1\ndefaults:\n  practices:\n    quiet: false\n",
      ).ok,
    ).toBe(true);
    expect(
      parseWorkflow(
        `schemaVersion: 1\nname: x\nnodes:\n  a:\n    type: agent.worker\n    prompt: hi\n    practices:\n      quiet: true\n`,
      ).ok,
    ).toBe(true);
  });

  it("refuses a word", () => {
    expect(
      parseProject(
        "schemaVersion: 1\ndefaults:\n  practices:\n    quiet: loud\n",
      ).ok,
    ).toBe(false);
  });
});
