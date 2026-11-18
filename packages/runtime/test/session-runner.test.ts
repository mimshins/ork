/**
 * @file Tests for the session runner on a stand-in adapter whose tool takes no
 *   stdin: the brief goes in its arguments, a message sent mid-session reaches
 *   the next leg, which resumes the session with it, unless the session ended
 *   in an error; the legs' usage adds up, an interrupt during the wiring starts
 *   no process, and the MCP wiring is released when the session ends. On the
 *   stand-in `claude`, a session stopped after a deferred call is never
 *   resumed, even while it waits for a heavy slot.
 */

import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import {
  createHolds,
  type MachinePort,
  type RunEvent,
  type RuntimeEvent,
  type SessionSpec,
  type SessionUsage,
} from "@krapht/ork-core";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  type CliAdapter,
  commandCodeDecoder,
  createCliRuntime,
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

/** Reports the `PWD` it was given, which OpenCode takes as its folder. */
const pwdAdapter: CliAdapter = {
  ...adapter,
  command: {
    bin: "node",
    args: () => [
      "-e",
      'console.log(JSON.stringify({ t: "result", id: "s1", text: process.env.PWD }));',
      "-",
      "-",
    ],
  },
};

describe("the session runner's process", () => {
  it("has PWD set to the session's folder, not Ork's", async () => {
    const folder = path.dirname(process.cwd());
    const events = await collect(
      createSessionRuntime(pwdAdapter, {
        env: { ...process.env, PWD: "/elsewhere" },
      }).start({ ...spec, cwd: folder }, { human }).events,
    );
    expect(events.at(-1)).toMatchObject({
      outcome: { text: `${folder} (resumed: )` },
    });
  });
});

/** Prints a Command Code result line, then is killed by a signal Ork never sent. */
const killedAfterResult: CliAdapter = {
  ...adapter,
  command: {
    bin: "node",
    args: () => [
      "-e",
      'console.log(JSON.stringify({ type: "result", subtype: "success", sessionId: "k1", finalText: "done" })); setTimeout(() => process.kill(process.pid, "SIGKILL"), 50);',
    ],
  },
  legDecoder: () => commandCodeDecoder(),
};

describe("the session runner, when a signal it did not send kills the tool", () => {
  it("keeps the result line the decoder held", async () => {
    const events = await collect(
      createSessionRuntime(killedAfterResult).start(spec, { human }).events,
    );
    expect(events.at(-1)).toMatchObject({
      outcome: { sessionId: "k1", text: "done", end: { kind: "no_report" } },
    });
  });
});

const FAKE_CLAUDE = fileURLToPath(
  new URL("fixtures/fake-claude.mjs", import.meta.url),
);

const claudeSpec = (): SessionSpec => ({
  ...spec,
  cwd: mkdtempSync(path.join(tmpdir(), "ork-runner-stop-")),
  model: "haiku",
  prompt: "Check the work",
});

/** A node's hold, paused or not, and the events it recorded. */
const holdFor = (paused: boolean) => {
  const recorded: RunEvent[] = [];
  const holds = createHolds({
    onEvent: event => {
      recorded.push(event);
    },
    onChange: () => {
      // Not under test.
    },
  });
  if (paused) holds.pause();
  return { recorded, hold: holds.forNode("worker") };
};

/** A machine whose slot ignores the stop and comes only when `free` is called. */
const stuckMachine = () => {
  const gives: ((release: () => void) => void)[] = [];
  const given: string[] = [];
  const machine: MachinePort = {
    priority: "normal",
    slot: () =>
      new Promise(resolve => {
        gives.push(resolve);
      }),
  };
  return {
    machine,
    asked: () => gives.length > 0,
    free: () => {
      for (const give of gives) {
        give(() => {
          given.push("released");
        });
      }
    },
    given,
  };
};

/**
 * Waits until `ready` and the leg wrote its deferred marker, then stops the
 * session.
 */
const stopOnceDeferred = async (
  session: { interrupt: () => Promise<void> },
  cwd: string,
  ready: () => boolean,
) => {
  while (!ready() || !existsSync(path.join(cwd, ".fake-deferred"))) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- polling a fake
    await delay(10);
  }
  await session.interrupt();
};

/** The session's events, or "hung" when it does not end within 5 seconds. */
const endedIn = (events: AsyncIterable<RuntimeEvent>) =>
  Promise.race([collect(events), delay(5000).then(() => "hung" as const)]);

const endKinds = (events: RuntimeEvent[] | "hung") =>
  events === "hung"
    ? ["hung"]
    : events.flatMap(e =>
        e.type === "session.finished" ? [e.outcome.end?.kind] : [],
      );

const spokenTexts = (events: RuntimeEvent[] | "hung") =>
  events === "hung"
    ? []
    : events.flatMap(e => (e.type === "assistant.text" ? [e.text] : []));

describe("the session runner, when a session with a deferred call is stopped", () => {
  it("ends it interrupted and never resumes it", async () => {
    const { recorded, hold } = holdFor(true);
    const own = claudeSpec();
    const session = createCliRuntime({
      bin: FAKE_CLAUDE,
      holdWindowMs: 30,
    }).start(own, { human, hold });
    const stopping = stopOnceDeferred(session, own.cwd, () =>
      recorded.some(e => e.type === "node.held"),
    );
    const events = await endedIn(session.events);
    await stopping;
    expect(endKinds(events)).toEqual(["interrupted"]);
    expect(spokenTexts(events)).toEqual(["Working on: Check the work"]);
  });

  it("ends it at once while it waits for a slot that never frees, and gives the slot back", async () => {
    const stuck = stuckMachine();
    const own = claudeSpec();
    const session = createCliRuntime({
      bin: FAKE_CLAUDE,
      holdWindowMs: 30,
      env: { ...process.env, FAKE_CLAUDE_BASH: "pnpm check" },
    }).start(own, {
      human,
      hold: holdFor(false).hold,
      machine: stuck.machine,
    });
    const stopping = stopOnceDeferred(session, own.cwd, stuck.asked);
    const events = await endedIn(session.events);
    await stopping;
    stuck.free();
    await delay(20);
    expect(endKinds(events)).toEqual(["interrupted"]);
    expect(spokenTexts(events)).toEqual(["Working on: Check the work"]);
    expect(stuck.given).toEqual(["released"]);
  });
});
