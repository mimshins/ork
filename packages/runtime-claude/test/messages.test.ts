/**
 * @file Tests for the message tools on a real bus: who gets `send_message`,
 *   `read_inbox` and `answer`, and what each says back to the session.
 */

import {
  compileWorkflow,
  createBus,
  type HumanChannel,
  type Ownership,
  type SessionPorts,
} from "@krapht/ork-core";
import { parseWorkflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import { handleRpc, orkTools } from "../src/index.ts";

const parsed = parseWorkflow(
  [
    "schemaVersion: 1",
    "name: t",
    "nodes:",
    "  lead: { type: claude.leader, prompt: lead }",
    "  fix: { type: claude.worker, parent: lead, prompt: fix }",
    "  alone: { type: claude.worker, prompt: alone }",
  ].join("\n"),
);
if (!parsed.ok) throw new Error("bad fixture");
const { graph } = compileWorkflow(parsed.workflow);
if (graph === null) throw new Error("bad fixture");

const human: HumanChannel = {
  ask: () => Promise.resolve("none"),
  permit: () => Promise.resolve({ allow: true }),
};

const ownership: Ownership = {
  children: [{ id: "fix", type: "claude.worker" }],
  templates: [],
  workersLeft: () => 0,
  delegate: () => Promise.resolve({ reports: [], notes: [] }),
  spawn: () => Promise.resolve({ reports: [], notes: [] }),
};

const setup = () => {
  const bus = createBus({
    graph,
    onEvent: () => {
      // Events are the bus's tests' concern.
    },
  });
  const tools = (nodeId: string, extra: Partial<SessionPorts> = {}) =>
    orkTools({
      nodeId,
      driver: "sdk",
      ports: { human, mailbox: bus.mailbox(nodeId), ...extra },
    });
  return { bus, tools };
};

const names = (list: { name: string }[]) => list.map(t => t.name);

/** Calls one tool over JSON-RPC and returns its text. */
const call = async (
  tools: ReturnType<typeof orkTools>,
  name: string,
  args: Record<string, unknown>,
) => {
  const reply = await handleRpc(tools, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  });
  return JSON.stringify(reply);
};

describe("the message tools", () => {
  it("go to nodes with someone to talk to; answer only to owners", () => {
    const { tools } = setup();
    expect(names(tools("alone"))).toEqual(["ask_user"]);
    expect(names(tools("fix"))).toEqual([
      "ask_user",
      "send_message",
      "read_inbox",
    ]);
    expect(names(tools("lead", { ownership }))).toEqual([
      "ask_user",
      "delegate",
      "send_message",
      "read_inbox",
      "answer",
    ]);
  });

  it("send, read and refuse with the reason", async () => {
    const { tools } = setup();
    const fix = tools("fix");
    const lead = tools("lead", { ownership });
    expect(
      await call(fix, "send_message", { to: "lead", body: "half done" }),
    ).toContain("Sent to lead; it is not running now");
    expect(
      await call(fix, "send_message", { to: "alone", body: "x" }),
    ).toContain(
      'Not sent: \\"alone\\" is not one of your contacts; you can message lead',
    );
    expect(await call(lead, "read_inbox", {})).toContain(
      String.raw`{\"messages\":[{\"from\":\"fix\",\"body\":\"half done\"}]}`,
    );
    expect(await call(lead, "read_inbox", {})).toContain("No unread messages.");
  });

  it("answer an owner question", async () => {
    const { bus, tools } = setup();
    const lead = tools("lead", { ownership });
    bus.mailbox("lead").connect(() => {
      // The question's text is the bus's tests' concern.
    });
    const answer = bus.askOwner("fix", {
      question: "Again?",
      options: [{ id: "stop" }, { id: "again" }],
    });
    expect(
      await call(lead, "answer", { question: "q1", choice: "no" }),
    ).toContain("Not answered");
    expect(
      await call(lead, "answer", { question: "q1", choice: "stop" }),
    ).toContain("Answered q1: stop.");
    expect(await answer).toBe("stop");
  });
});
