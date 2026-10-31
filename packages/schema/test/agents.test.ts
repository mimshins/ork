/**
 * @file Tests for agent files: the portable markdown and the Ork sidecar,
 *   reading what other tools wrote, the canonical form, the settings an agent
 *   shares with Claude nodes, and the published agent.schema.json.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  AGENT_SETTING_KEYS,
  agentSettings,
  type AgentFileResult,
  parseAgentFile,
  renderAgentJsonSchema,
  serializeAgent,
} from "../src/index.ts";

const agentOf = (result: AgentFileResult) => {
  if (!result.ok) throw new Error(result.message);
  return result;
};

const orUndefined = (text: string | null): string | undefined =>
  text ?? undefined;

const messageOf = (result: AgentFileResult): string =>
  result.ok ? "" : result.message;

const APPROVER = {
  description: "Decides whether a branch is ready to merge.",
  instructions: "You approve merges.\n\nSay why.",
  model: "opus",
  isolation: "readonly",
  output: { schema: { verdict: ["approve", "escalate"] } },
} as const;

describe("agent files", () => {
  it("write a portable markdown and a sidecar, and read back the same agent", () => {
    const { markdown, sidecar } = serializeAgent("approver", APPROVER);
    expect(markdown).toBe(
      [
        "---",
        "name: approver",
        "description: Decides whether a branch is ready to merge.",
        "---",
        "",
        "You approve merges.",
        "",
        "Say why.",
        "",
      ].join("\n"),
    );
    expect(sidecar).toContain("# yaml-language-server: $schema=");
    expect(sidecar).toContain("isolation: readonly");
    expect(sidecar).not.toContain("instructions");

    const read = agentOf(parseAgentFile(markdown, orUndefined(sidecar), "x"));
    expect(read).toEqual({ ok: true, name: "approver", agent: APPROVER });
    expect(serializeAgent(read.name, read.agent)).toEqual({
      markdown,
      sidecar,
    });
  });

  it("have no sidecar when the agent has no Ork settings", () => {
    expect(serializeAgent("plain", { instructions: "Hi." }).sidecar).toBeNull();
  });

  it("read another tool's agent: its model, the file name for a name", () => {
    const claude =
      "---\ndescription: Reviews.\nmodel: haiku\ntools: Read, Grep\n---\nReview.\n";
    expect(agentOf(parseAgentFile(claude, undefined, "reviewer"))).toEqual({
      ok: true,
      name: "reviewer",
      agent: {
        description: "Reviews.",
        instructions: "Review.",
        model: "haiku",
      },
    });
    const inherit = "---\nname: a\nmodel: inherit\n---\n";
    expect(
      agentOf(parseAgentFile(inherit, "model: opus\n", "a")).agent,
    ).toEqual({
      model: "opus",
    });
  });

  it("report a bad name or a bad sidecar", () => {
    expect(
      parseAgentFile("---\nname: Bad Name\n---\n", undefined, "x"),
    ).toMatchObject({
      ok: false,
    });
    expect(
      messageOf(
        parseAgentFile("---\nname: a\n---\n", "isolation: sideways\n", "a"),
      ),
    ).toContain(".agent.yaml: isolation");
  });

  it("share every setting with Claude nodes", () => {
    expect([...AGENT_SETTING_KEYS].toSorted()).toEqual(
      Object.keys(agentSettings).toSorted(),
    );
  });
});

describe("agent.schema.json", () => {
  it("is up to date (run `pnpm --dir packages/schema gen:json-schema`)", () => {
    const committed = readFileSync(
      new URL("../agent.schema.json", import.meta.url),
      "utf8",
    );
    expect(committed).toBe(renderAgentJsonSchema());
  });
});
