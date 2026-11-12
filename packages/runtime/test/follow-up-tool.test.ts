/**
 * @file Tests for the `follow_up` tool: only sessions of a run that keeps
 *   follow-ups get it; it hands a checked follow-up to the port and says what
 *   became of it (kept, merged, relayed), refuses a bad `for` or `due`, and
 *   passes the port's refusal on.
 */

import type {
  FollowUpDelivered,
  FollowUpPort,
  HumanChannel,
  NewFollowUp,
} from "@krapht/ork-core";
import { describe, expect, it } from "vitest";

import { handleRpc, orkTools } from "../src/index.ts";

const human: HumanChannel = {
  ask: () => Promise.resolve("none"),
  permit: () => Promise.resolve({ allow: true }),
};

const kept = (merged: boolean): FollowUpDelivered => ({
  ok: true,
  added: {
    merged,
    followUp: {
      id: "f1",
      project: "/p",
      title: "t",
      body: "",
      for: "project:api",
      kind: "change",
      due: "after-merge",
      where: [],
      from: {},
      status: "waiting",
      place: "store",
      createdAt: "",
      updatedAt: "",
    },
  },
  relayed: { run: "r9", node: "lead" },
});

/** A port answering `answer`, recording what it was given. */
const portOf = (answer: FollowUpDelivered) => {
  const given: NewFollowUp[] = [];
  const port: FollowUpPort = {
    add: input => {
      given.push(input);
      return Promise.resolve(answer);
    },
  };
  return { port, given };
};

const call = async (port: FollowUpPort, args: Record<string, unknown>) => {
  const tools = orkTools({
    nodeId: "fix",
    driver: "claude-code",
    ports: { human, followUps: port },
  });
  const reply = await handleRpc(tools, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "follow_up", arguments: args },
  });
  return JSON.stringify(reply);
};

const ARGS = {
  title: "Update the API client",
  for: "project:api",
  kind: "change",
  due: "after-merge",
  where: ["src/client.ts"],
};

const names = (ports: Parameters<typeof orkTools>[0]["ports"]) =>
  orkTools({ nodeId: "fix", driver: "claude-code", ports }).map(t => t.name);

describe("the follow_up tool", () => {
  it("goes only to sessions whose run keeps follow-ups", () => {
    expect(names({ human })).not.toContain("follow_up");
    expect(names({ human, followUps: portOf(kept(false)).port })).toContain(
      "follow_up",
    );
  });

  it("hands the follow-up to the port and says where it went", async () => {
    const { port, given } = portOf(kept(false));
    const reply = await call(port, ARGS);
    expect(given).toEqual([ARGS]);
    expect(reply).toContain("Kept as follow-up f1.");
    expect(reply).toContain("Also sent to r9/lead");
  });

  it("passes the ref it waits on", async () => {
    const { port, given } = portOf(kept(false));
    await call(port, { ...ARGS, ref: "ork/r1" });
    expect(given.map(g => g.ref)).toEqual(["ork/r1"]);
  });

  it("says when it merged into one already kept", async () => {
    const { port } = portOf(kept(true));
    expect(await call(port, ARGS)).toContain("Merged into follow-up f1");
  });

  it.each([
    [{ ...ARGS, for: "team" }],
    [{ ...ARGS, due: "soon" }],
    [{ ...ARGS, kind: "chore" }],
  ])("refuses %o before the port sees it", async args => {
    const { port, given } = portOf(kept(false));
    expect(await call(port, args)).toContain('"isError":true');
    expect(given).toEqual([]);
  });

  it("passes the port's refusal on", async () => {
    const { port } = portOf({ ok: false, error: "no such project" });
    expect(await call(port, ARGS)).toContain("Not kept: no such project.");
  });
});
