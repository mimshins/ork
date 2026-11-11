/** @file Tests for `renameNodeTypes`: the rewrite `ork migrate` does (RFC-015). */

import { describe, expect, it } from "vitest";

import {
  parseWorkflow,
  renameNodeTypes,
  serializeWorkflow,
} from "../src/index.ts";

const OLD = `schemaVersion: 1
name: t
defaults:
  model: sonnet
nodes:
  lead:
    type: claude.leader
    prompt: plan
    model: deepseek/deepseek-v4.1-flash
  build:
    type: claude.worker
    prompt: go
    parent: lead
  sub:
    type: claude.subagent
    prompt: help
    description: when asked
    parent: build
  run:
    type: tool.shell
    command: ls
`;

const COMMENTED = `# why this workflow exists
schemaVersion: 1
name: t
nodes:
  build:
    # the builder
    type: claude.worker
    prompt: go # keep it small
`;

const renamedOf = (text: string) => {
  const result = renameNodeTypes(text);
  if (result === null || !result.ok) throw new Error("expected a rewrite");
  return result;
};

const reserialized = (text: string) => {
  const parsed = parseWorkflow(text);
  if (!parsed.ok) throw new Error("expected valid");
  return serializeWorkflow(parsed.workflow);
};

describe("renameNodeTypes", () => {
  it("renames the three types and counts each", () => {
    const { text, renamed } = renamedOf(OLD);
    expect(renamed).toEqual({
      "claude.leader": 1,
      "claude.worker": 1,
      "claude.subagent": 1,
    });
    expect(text).toContain("type: agent.worker");
    expect(text).not.toContain("claude.");
  });

  it("leaves models as they are", () => {
    const { text } = renamedOf(OLD);
    expect(text).toContain("model: deepseek/deepseek-v4.1-flash");
    expect(text).toContain("model: sonnet");
  });

  it("keeps the comments of the file", () => {
    const { text } = renamedOf(COMMENTED);
    expect(text).toContain("# why this workflow exists");
    expect(text).toContain("    # the builder");
    expect(text).toContain("    prompt: go # keep it small");
    expect(text).toContain("type: agent.worker");
  });

  it("keeps an already canonical file canonical", () => {
    const canonical = reserialized(renamedOf(OLD).text);
    const old = canonical.replaceAll("agent.", "claude.");
    expect(renamedOf(old).text).toBe(canonical);
  });

  it("adds the schema line to a file that lacks it", () => {
    expect(renamedOf(OLD).text.startsWith("# yaml-language-server:")).toBe(
      true,
    );
  });

  it("does nothing to a file that names none, so a second run is a no-op", () => {
    expect(renameNodeTypes(renamedOf(OLD).text)).toBeNull();
  });

  it("does not rewrite a file that does not validate once renamed", () => {
    const result = renameNodeTypes(
      OLD.replace("name: t\n", "name: t\nbogus: 1\n"),
    );
    expect(result).toMatchObject({ ok: false });
  });

  it("names a file that is not YAML", () => {
    const result = renameNodeTypes("nodes: [\n  type: claude.worker\n");
    expect(result).toMatchObject({ ok: false });
  });
});
