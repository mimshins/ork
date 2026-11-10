/**
 * @file Tests for the session runner on a stand-in adapter whose tool takes no
 *   stdin: the brief goes in its arguments, a message sent mid-session reaches
 *   the next leg, which resumes the session with it, unless the session ended
 *   in an error; the legs' usage adds up, an interrupt during the wiring starts
 *   no process, and the MCP wiring is released when the session ends.
 */

import { setTimeout as delay } from "node:timers/promises";

import type { RuntimeEvent, SessionSpec, SessionUsage } from "@krapht/ork-core";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  type CliAdapter,
  createSessionRuntime,
  type Decoded,
} from "../src/index.ts";

/** Prints a start and a result naming the prompt it was given and its resume. */
const TOOL = `
const [prompt, resume] = process.argv.slice(-2);
const id = resume === "-" ? "s1" : resume;
setTimeout(() => {
  console.log(JSON.stringify({ t: "start", id }));
  console.log(JSON.stringify({ t: "result", id, text: prompt, resumed: resume }));
}, 50);
`;

const usage = (turns: number): SessionUsage => ({
  costUsd: 0,
  inputTokens: 10,
  outputTokens: 1,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  turns,
  durationMs: 0,
});

const decode = (line: string): Decoded => {
  const message = z.record(z.string(), z.string()).parse(JSON.parse(line));
  if (message["t"] === "start") {
    return {
      events: [
        { type: "session.started", sessionId: message["id"] ?? "", model: "m" },
      ],
    };
  }
  return {
    events: [
      {
        type: "session.finished",
        outcome: {
          subtype:
            message["text"]?.startsWith("Fail") === true
              ? "error_max_turns"
              : "success",
          sessionId: message["id"] ?? "",
          report: null,
          text: `${message["text"] ?? ""} (resumed: ${message["resumed"] ?? ""})`,
          usage: usage(1),
          errors: [],
        },
      },
    ],
  };
};

const released: string[] = [];

beforeEach(() => {
  released.length = 0;
});

const adapter: CliAdapter = {
  driver: "open-code",
  command: {
    bin: "node",
    args: spec => ["-e", TOOL, spec.prompt, spec.resume ?? "-"],
  },
  decode,
  mcp: {
    kind: "config-file",
    wire: spec =>
      Promise.resolve({
        args: [],
        env: { STAND_IN_CONFIG: "x" },
        release: () => {
          released.push(spec.nodeId);
          return Promise.resolve();
        },
      }),
  },
  permissions: { kind: "rules", denyByDefault: true },
  usage: {
    dollars: false,
    combine: (a, b) => ({ ...b, turns: a.turns + b.turns }),
  },
  context: { instructions: [], skills: "", agents: "", env: () => ({}) },
};

const spec: SessionSpec = {
  nodeId: "worker",
  cwd: process.cwd(),
  prompt: "Write it",
  systemAppend: "",
  settingSources: ["project"],
  tools: { allow: [], deny: [] },
  permissionMode: "default",
  reportSchema: { type: "object" },
};

const human = {
  permit: () => Promise.resolve({ allow: true as const }),
  ask: () => Promise.resolve("a"),
};

const collect = async (events: AsyncIterable<RuntimeEvent>) => {
  const all: RuntimeEvent[] = [];
  for await (const event of events) all.push(event);
  return all;
};

describe("the session runner, for a tool with no stdin", () => {
  it("brings a mid-session message in a resumed leg, as one session", async () => {
    const session = createSessionRuntime(adapter).start(spec, { human });
    session.send("Also add tests");
    const events = await collect(session.events);
    expect(events.map(e => e.type)).toEqual([
      "session.started",
      "session.finished",
    ]);
    expect(events.at(-1)).toMatchObject({
      outcome: {
        text: "Also add tests (resumed: s1)",
        usage: { turns: 2 },
      },
    });
    expect(released).toEqual(["worker"]);
  });

  it("ends after one leg when no message waits", async () => {
    const events = await collect(
      createSessionRuntime(adapter).start(spec, { human }).events,
    );
    expect(events.at(-1)).toMatchObject({
      outcome: { text: "Write it (resumed: -)", usage: { turns: 1 } },
    });
  });
});

/** Wiring that takes a while, as `cmd mcp add` can. */
const slowWire: CliAdapter = {
  ...adapter,
  mcp: {
    kind: "lease",
    wire: async wired => {
      await delay(100);
      return {
        args: [],
        env: {},
        release: () => {
          released.push(`slow:${wired.nodeId}`);
          return Promise.resolve();
        },
      };
    },
  },
};

describe("the session runner, when a session ends early", () => {
  it("does not continue an errored session with a queued message", async () => {
    const session = createSessionRuntime(adapter).start(
      { ...spec, prompt: "Fail fast" },
      { human },
    );
    session.send("Also add tests");
    const events = await collect(session.events);
    expect(events.at(-1)).toMatchObject({
      outcome: {
        subtype: "error_max_turns",
        text: "Fail fast (resumed: -)",
        usage: { turns: 1 },
      },
    });
  });

  it("starts no process when interrupted during the wiring, and releases it", async () => {
    const session = createSessionRuntime(slowWire).start(spec, { human });
    const done = collect(session.events);
    setTimeout(() => void session.interrupt(), 20);
    const events = await done;
    expect(events).toMatchObject([
      {
        type: "session.finished",
        outcome: { subtype: "error_driver", errors: ["interrupted"] },
      },
    ]);
    expect(released).toEqual(["slow:worker"]);
  });
});
