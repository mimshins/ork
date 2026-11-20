/**
 * @file Tests for the session runner on a stand-in adapter whose tool speaks
 *   JSON frames both ways (`CliAdapter.protocol`, RFC-027), on a fake tool
 *   (`fixtures/fake-rpc-session.mjs`): a message sent before and after the leg
 *   is up reaches the session as a message frame, an approval ask reaches the
 *   human channel and is answered, an interrupt ends the session interrupted
 *   with no report, and a deferred call ends the leg and resumes the session on
 *   continue with the codec's resume message and the legs' usage combined (or
 *   once a heavy slot frees, saying the slot was the reason), or never resumes
 *   it once stopped, or fails it when it has no session id. A message sent
 *   during the deferral's abort or between legs reaches the resumed leg once;
 *   one sent after a stop is dropped. A driver that takes host tools gets Ork's
 *   tools on its leg and an endpoint that lists none.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  createHolds,
  fileSlotLedger,
  type MachinePort,
  machinePort,
  type RunEvent,
  type RuntimeEvent,
  type SessionSpec,
  type SessionUsage,
  type SlotLedger,
} from "@krapht/ork-core";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type {
  CliAdapter,
  Codec,
  DecodedFrame,
  Frame,
  LegContext,
} from "../src/adapter.ts";
import { createSessionRuntime } from "../src/index.ts";

const FAKE = path.join(import.meta.dirname, "fixtures/fake-rpc-session.mjs");

const usageOf = (tokens: number): SessionUsage => ({
  costUsd: 0,
  inputTokens: tokens,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  turns: 1,
  durationMs: 0,
});

/** What the codecs of a session were asked to write, and the last leg's context. */
type Written = {
  interrupts: number;
  opened: string[];
  leg?: LegContext;
  /** Called as a leg writes its interrupt, while it is still deferring. */
  onInterrupt?: () => void;
};

const decoders: Record<string, (frame: Frame) => DecodedFrame> = {
  ready: () => ({ events: [], ready: true }),
  response: frame => ({ events: [], reply: { id: String(frame["id"]) } }),
  started: frame => ({
    events: [
      {
        type: "session.started",
        sessionId: String(frame["session"]),
        model: "fake",
      },
    ],
  }),
  said: frame => ({
    events: [{ type: "assistant.text", text: String(frame["text"]) }],
  }),
  ask: frame => ({
    events: [],
    ask: {
      id: String(frame["id"]),
      tool: String(frame["tool"]),
      args: { command: "ls" },
    },
  }),
  settled: frame => ({
    events: [
      {
        type: "session.finished",
        outcome: {
          subtype: "success",
          sessionId: String(frame["session"]),
          report: null,
          text: String(frame["text"]),
          usage: usageOf(Number(frame["tokens"])),
          errors: [],
        },
      },
    ],
  }),
};

/** A codec for one leg: a resumed leg opens with `again`, not the prompt. */
const codecOf = (written: Written): Codec => {
  let n = 0;
  const request = (frame: Frame) => {
    n += 1;
    const id = `r${String(n)}`;
    return { id, frame: { ...frame, id } };
  };
  return {
    open: (legSpec, leg) => {
      const text =
        legSpec.resume === undefined || legSpec.fork === true
          ? legSpec.prompt
          : "again";
      written.opened.push(
        leg.deferredFor === undefined ? text : `${text} (${leg.deferredFor})`,
      );
      written.leg = leg;
      return [request({ type: "prompt", text })];
    },
    decode: frame =>
      (decoders[String(frame["type"])] ?? (() => ({ events: [] })))(frame),
    message: text => request({ type: "steer", text }),
    interrupt: () => {
      written.interrupts += 1;
      written.onInterrupt?.();
      return request({ type: "abort" });
    },
    answer: (ask, decision) => ({
      type: "answer",
      id: ask.id,
      value: decision,
    }),
    callResult: (call, result) => ({ type: "result", id: call.id, result }),
  };
};

const adapterOf = (written: Written, hostTools = false): CliAdapter => ({
  ...(hostTools ? { hostTools: true } : {}),
  driver: "omp",
  command: {
    bin: "fake-rpc",
    args: (spec, leg) => [
      FAKE,
      spec.resume ?? "-",
      leg.endpoint.holdUrl ?? "-",
      leg.endpoint.token,
    ],
  },
  decode: () => ({ events: [] }),
  protocol: () => codecOf(written),
  mcp: {
    kind: "flag",
    wire: () =>
      Promise.resolve({ args: [], env: {}, release: () => Promise.resolve() }),
  },
  permissions: { kind: "callback", denyByDefault: true },
  hold: { answer: answer => ({ answer }), windowMs: 30 },
  usage: {
    dollars: false,
    combine: (a, b) => ({
      ...b,
      inputTokens: a.inputTokens + b.inputTokens,
      turns: a.turns + b.turns,
    }),
  },
  context: { instructions: [], skills: "", agents: "", env: () => ({}) },
});

const specOf = (prompt: string): SessionSpec => ({
  nodeId: "worker",
  cwd: process.cwd(),
  prompt,
  systemAppend: "",
  settingSources: ["project"],
  tools: { allow: [], deny: [] },
  permissionMode: "default",
  reportSchema: { type: "object" },
});

type Permit = { allow: true } | { allow: false; message: string };

/** A human channel answering every permission prompt with `answer`. */
const humanOf = (answer: Permit) => {
  const asked: unknown[] = [];
  return {
    asked,
    human: {
      permit: (request: unknown) => {
        asked.push(request);
        return Promise.resolve(answer);
      },
      ask: () => Promise.resolve("a"),
    },
  };
};

/** A machine port where the fake's hooked call (`ls`) is heavy. */
const machineOf = (ledger: SlotLedger, recorded: RunEvent[]): MachinePort => {
  const port = machinePort(
    {
      machine: { rules: { heavy: ["ls"], priority: "normal" }, ledger },
      onEvent: event => {
        recorded.push(event);
      },
    },
    "r1",
    "worker",
    { waitFor: (_, wait) => wait() },
  );
  if (port === undefined) throw new Error("no machine port");
  return port;
};

/** Starts a session of `prompt` on the fake tool, collecting its events. */
const start = (
  prompt: string,
  options: {
    answer?: Permit;
    paused?: boolean;
    fork?: boolean;
    machine?: MachinePort;
    hostTools?: boolean;
  } = {},
) => {
  const written: Written = { interrupts: 0, opened: [] };
  const recorded: RunEvent[] = [];
  const holds = createHolds({
    onEvent: event => {
      recorded.push(event);
    },
    onChange: () => {
      // Not under test.
    },
  });
  if (options.paused === true) holds.pause();
  const { asked, human } = humanOf(options.answer ?? { allow: true });
  const port = holds.forNode("worker");
  /** The hold waits so far: the hook's, then the runner's between legs. */
  const waits = { count: 0 };
  const hold: typeof port = {
    ...port,
    wait: (at, signal) => {
      waits.count += 1;
      return port.wait(at, signal);
    },
  };
  const session = createSessionRuntime(adapterOf(written, options.hostTools), {
    bin: process.execPath,
    holdWindowMs: 30,
  }).start(
    options.fork === true
      ? { ...specOf(prompt), resume: "source", fork: true }
      : specOf(prompt),
    {
      human,
      hold,
      ...(options.machine === undefined ? {} : { machine: options.machine }),
    },
  );
  const events: RuntimeEvent[] = [];
  const finish = (async () => {
    for await (const event of session.events) events.push(event);
  })();
  return { session, events, finish, written, holds, asked, waits };
};

/** Long enough for a Node process to start on a loaded machine. */
const WAIT = { timeout: 5000 };

const texts = (events: RuntimeEvent[]): string[] =>
  events.flatMap(event =>
    event.type === "assistant.text" ? [event.text] : [],
  );

const outcomes = (events: RuntimeEvent[]) =>
  events.flatMap(event =>
    event.type === "session.finished" ? [event.outcome] : [],
  );

const saidAll = async (events: RuntimeEvent[], said: string[]) => {
  await vi.waitFor(() => {
    expect(texts(events)).toEqual(said);
  }, WAIT);
};

const deferredOnce = async (written: Written) => {
  await vi.waitFor(() => {
    expect(written.interrupts).toBe(1);
  }, WAIT);
};

const ListSchema = z.object({
  result: z.object({ tools: z.array(z.object({ name: z.string() })) }),
});

/** The names in the `tools/list` of the endpoint the running leg was given. */
const listedTools = async (written: Written): Promise<string[]> => {
  await vi.waitFor(() => {
    expect(written.leg).toBeDefined();
  }, WAIT);
  const endpoint = written.leg?.endpoint ?? { url: "", token: "" };
  const reply = await fetch(endpoint.url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${endpoint.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  const body = ListSchema.parse(await reply.json());
  return body.result.tools.map(tool => tool.name);
};

/** A session on the fake tool, its leg's context and its endpoint's tools. */
const offered = async (hostTools: boolean) => {
  const run = start("Work", { hostTools });
  const listed = await listedTools(run.written);
  run.session.send("finish");
  await run.finish;
  return { leg: run.written.leg, listed };
};

describe("the session runner, for a tool that speaks frames both ways", () => {
  it("gives a host-tools driver Ork's tools as host tools, its endpoint listing none", async () => {
    const { leg, listed } = await offered(true);
    expect(listed).toEqual([]);
    expect(leg?.allowed).toContain("mcp__ork__ask_user");
    const tool = leg?.hostTools?.find(each => each.name === "ork_ask_user");
    expect(tool?.parameters).toMatchObject({ type: "object" });
    const result = await tool?.call({});
    expect(result?.isError).toBe(true);
    expect(result?.content[0]?.text).toMatch(
      /^Invalid arguments, nothing ran:/u,
    );
  });

  it("serves Ork's tools on its endpoint to any other driver, with no host tools", async () => {
    const { leg, listed } = await offered(false);
    expect(listed).toContain("ask_user");
    expect(leg?.hostTools).toBeUndefined();
  });

  it("sends a message before and after the leg is up as a message frame", async () => {
    const run = start("Work");
    run.session.send("early");
    await saidAll(run.events, ["Work", "early"]);
    run.session.send("late");
    run.session.send("finish");
    await run.finish;
    expect(texts(run.events)).toEqual(["Work", "early", "late", "finish"]);
    expect(outcomes(run.events).map(outcome => outcome.text)).toEqual([
      "finished",
    ]);
  });

  it("asks the human channel about a tool call and answers allow", async () => {
    const run = start("ask");
    await run.finish;
    expect(run.asked).toMatchObject([
      { nodeId: "worker", toolName: "bash", input: { command: "ls" } },
    ]);
    expect(texts(run.events)).toEqual(["allow"]);
  });

  it("answers deny when the human channel denies", async () => {
    const run = start("ask", { answer: { allow: false, message: "no" } });
    await run.finish;
    expect(texts(run.events)).toEqual(["deny"]);
  });

  it("ends an interrupted session interrupted, with no report", async () => {
    const run = start("wait");
    await saidAll(run.events, ["wait"]);
    await run.session.interrupt();
    await run.finish;
    expect(run.written.interrupts).toBe(1);
    expect(outcomes(run.events)).toMatchObject([
      { report: null, end: { kind: "interrupted" } },
    ]);
  });

  it("ends the leg at a deferred call and resumes it on continue, with the legs' usage combined", async () => {
    const run = start("hold", { paused: true });
    await deferredOnce(run.written);
    run.holds.proceed();
    await run.finish;
    expect(run.written.opened).toEqual(["hold", "again (pause)"]);
    expect(texts(run.events)).toEqual(["again"]);
    expect(outcomes(run.events)).toMatchObject([
      { sessionId: "s1", text: "again", usage: { inputTokens: 10, turns: 2 } },
    ]);
  });

  it("resumes a call deferred for a heavy slot that frees late, saying it was the slot", async () => {
    const ledger = fileSlotLedger({
      dir: mkdtempSync(path.join(tmpdir(), "ork-duplex-slots-")),
      slots: 1,
      pollMs: 10,
    });
    const other = await ledger.take(
      { run: "r0", node: "check", pid: process.pid },
      { signal: new AbortController().signal },
    );
    const recorded: RunEvent[] = [];
    const run = start("hold", { machine: machineOf(ledger, recorded) });
    await vi.waitFor(() => {
      expect(recorded.map(event => event.type)).toContain("slot.waiting");
    }, WAIT);
    await deferredOnce(run.written);
    other?.();
    await run.finish;
    expect(recorded.map(event => event.type)).toEqual([
      "slot.waiting",
      "slot.taken",
    ]);
    expect(run.written.opened).toEqual(["hold", "again (slot)"]);
    expect(ledger.holders()).toEqual([]);
  });

  it("delivers a message sent during a deferral's abort once, to the resumed leg", async () => {
    const run = start("hold-wait", { paused: true });
    run.written.onInterrupt = () => {
      run.session.send("finish");
    };
    await deferredOnce(run.written);
    run.holds.proceed();
    await run.finish;
    expect(run.written.opened).toEqual(["hold-wait", "again (pause)"]);
    expect(texts(run.events)).toEqual(["again", "finish"]);
    expect(outcomes(run.events)).toMatchObject([
      { sessionId: "s2", text: "finished" },
    ]);
  });

  it("delivers a message sent while idle between legs once, to the resumed leg", async () => {
    const run = start("hold-wait", { paused: true });
    // The second wait is the runner's, once the deferred leg has ended.
    await vi.waitFor(() => {
      expect(run.waits.count).toBe(2);
    }, WAIT);
    run.session.send("finish");
    run.holds.proceed();
    await run.finish;
    expect(run.written.opened).toEqual(["hold-wait", "again (pause)"]);
    expect(texts(run.events)).toEqual(["again", "finish"]);
    expect(outcomes(run.events)).toMatchObject([
      { sessionId: "s2", text: "finished" },
    ]);
  });

  it("drops a message sent after a stop and starts no leg for it", async () => {
    const run = start("wait");
    await saidAll(run.events, ["wait"]);
    await run.session.interrupt();
    run.session.send("late");
    await run.finish;
    run.session.send("later");
    expect(run.written.opened).toEqual(["wait"]);
    expect(texts(run.events)).toEqual(["wait"]);
    expect(outcomes(run.events)).toMatchObject([
      { end: { kind: "interrupted" } },
    ]);
  });

  it("never resumes a session stopped while deferred", async () => {
    const run = start("hold", { paused: true });
    await deferredOnce(run.written);
    await run.session.interrupt();
    await run.finish;
    expect(run.written.opened).toEqual(["hold"]);
    expect(outcomes(run.events)).toMatchObject([
      { end: { kind: "interrupted" } },
    ]);
  });

  it("never resumes the source of a fork that defers before naming its session", async () => {
    const run = start("hold-nameless", { paused: true, fork: true });
    await run.finish;
    expect(run.written.opened).toEqual(["hold-nameless"]);
    expect(outcomes(run.events)).toMatchObject([
      { end: { kind: "driver_crashed" } },
    ]);
  });

  it("fails a deferred leg that never named its session", async () => {
    const run = start("hold-nameless", { paused: true });
    await run.finish;
    expect(run.written.opened).toEqual(["hold-nameless"]);
    expect(outcomes(run.events)).toMatchObject([
      {
        end: { kind: "driver_crashed" },
        errors: [
          "fake-rpc stopped before it named its session, so it cannot resume",
        ],
      },
    ]);
  });
});
