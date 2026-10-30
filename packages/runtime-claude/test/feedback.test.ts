/**
 * @file Tests for the `feedback` tool on the run's real feedback port: who gets
 *   it, and what it records and says back.
 */

import {
  compileWorkflow,
  createFeedback,
  type HumanChannel,
  type RunEvent,
} from "@krapht/ork-core";
import { parseWorkflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import { handleRpc, orkTools } from "../src/index.ts";

const parsed = parseWorkflow(
  [
    "schemaVersion: 1",
    "name: t",
    "nodes:",
    "  fix: { type: claude.worker, prompt: f }",
  ].join("\n"),
);
if (!parsed.ok) throw new Error("bad fixture");
const { graph } = compileWorkflow(parsed.workflow);
if (graph === null) throw new Error("bad fixture");

const human: HumanChannel = {
  ask: () => Promise.resolve("none"),
  permit: () => Promise.resolve({ allow: true }),
};

describe("the feedback tool", () => {
  it("goes to sessions in a run, records a report and says so", async () => {
    const events: RunEvent[] = [];
    const port = createFeedback({
      graph,
      onEvent: event => {
        events.push(event);
      },
    }).port("fix");
    expect(
      orkTools({ nodeId: "fix", driver: "sdk", ports: { human } }).map(
        t => t.name,
      ),
    ).toEqual(["ask_user"]);
    const tools = orkTools({
      nodeId: "fix",
      driver: "sdk",
      ports: { human, feedback: port },
    });
    expect(tools.map(t => t.name)).toEqual(["ask_user", "feedback"]);
    const reply = await handleRpc(tools, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "feedback",
        arguments: {
          kind: "context-gap",
          title: "AGENTS.md has no test command",
          evidence: ["AGENTS.md"],
        },
      },
    });
    expect(JSON.stringify(reply)).toContain("Recorded.");
    expect(events).toMatchObject([
      {
        type: "feedback.recorded",
        node: "fix",
        feedback: {
          source: "agent",
          kind: "context-gap",
          target: "project",
          title: "AGENTS.md has no test command",
        },
      },
    ]);
  });
});
