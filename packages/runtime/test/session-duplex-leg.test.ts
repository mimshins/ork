/**
 * @file Tests for the duplex leg (`runDuplexLeg`, RFC-027) on a tiny fake tool
 *   that speaks JSON frames (`fixtures/fake-frames.mjs`) and a trivial codec:
 *   the handshake, requests matched by id and failed at the end, approvals,
 *   host tool calls, stop and kill, deferral, messages held or dropped, no
 *   timer left behind, a codec ready at spawn or waiting for a turn, and the
 *   failures a frame or an exit ends it with.
 */

import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import type { RuntimeEvent, SessionSpec, SessionUsage } from "@krapht/ork-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  Ask,
  CliAdapter,
  Codec,
  Decision,
  DecodedFrame,
  Frame,
  HostTool,
} from "../src/adapter.ts";
import type * as FrameLines from "../src/frame-lines.ts";
import type { Leg } from "../src/leg-step.ts";
import { runDuplexLeg } from "../src/session-duplex-leg.ts";
import type { DuplexIo } from "../src/session-leg.ts";
import { text as toolText } from "../src/tools/tool.ts";

/** Every request the leg waited on, so a test can see none is left pending. */
const waited = vi.hoisted((): { id: string; reply: Promise<void> }[] => []);

vi.mock("../src/frame-lines.ts", async importOriginal => {
  const real = await importOriginal<typeof FrameLines>();
  return {
    ...real,
    requestTable: (ended: () => Error) => {
      const table = real.requestTable(ended);
      return {
        ...table,
        wait: (id: string) => {
          const reply = table.wait(id);
          reply.catch(() => null);
          waited.push({ id, reply });
          return reply;
        },
      };
    },
  };
});

const FAKE = path.join(import.meta.dirname, "fixtures/fake-frames.mjs");

const usageOf = (tokens: number): SessionUsage => ({
  costUsd: 0,
  inputTokens: tokens,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  turns: 1,
  durationMs: 0,
});

/** What the fake codec saw: the tool's pid, and the host calls it answered. */
type Seen = { pid: number; answered: string[] };

/** The codec's optional parts a test turns on. */
type Parts = Pick<Codec, "readyAtSpawn" | "waitsForTurn">;

/** The fake tool's frames as Ork's events; `seen` keeps what it saw. */
const fakeCodec = (seen: Seen, parts: Parts): Codec => {
  let n = 0;
  const request = (frame: Frame) => {
    n += 1;
    const id = `r${String(n)}`;
    return { id, frame: { ...frame, id } };
  };
  const decoders: Record<string, (frame: Frame) => DecodedFrame> = {
    pid: frame => {
      seen.pid = Number(frame["pid"]);
      return { events: [] };
    },
    ready: () => ({ events: [], ready: true }),
    turn: () => ({ events: [], turn: true }),
    response: frame => ({
      events: [],
      reply: {
        id: String(frame["id"]),
        ...(typeof frame["error"] === "string"
          ? { error: frame["error"] }
          : {}),
      },
    }),
    started: frame => ({
      events: [
        {
          type: "session.started",
          sessionId: String(frame["session"]),
          model: "fake",
        },
      ],
    }),
    usage: frame => ({ events: [], usage: usageOf(Number(frame["tokens"])) }),
    said: frame => ({
      events: [{ type: "assistant.text", text: String(frame["text"]) }],
    }),
    settled: frame => ({
      events: [
        {
          type: "session.finished",
          outcome: {
            subtype: "success",
            sessionId: "s1",
            report: null,
            text: String(frame["text"]),
            usage: usageOf(7),
            errors: [],
          },
        },
      ],
    }),
    ask: frame => ({
      events: [],
      ask: {
        id: String(frame["id"]),
        tool: String(frame["tool"]),
        args: { command: "ls" },
      },
    }),
    call: frame => ({
      events: [],
      call: {
        id: String(frame["id"]),
        tool: String(frame["tool"]),
        args: { n: 1 },
      },
    }),
    chunk: () => ({
      events: [],
      fail: "fake-frames sent a frame in chunks, over its 1048576-byte frame limit",
    }),
  };
  return {
    ...parts,
    open: spec => [request({ type: "prompt", text: spec.prompt })],
    decode: frame =>
      (decoders[String(frame["type"])] ?? (() => ({ events: [] })))(frame),
    message: text => request({ type: "steer", text }),
    interrupt: () => request({ type: "abort" }),
    answer: (ask, decision) => ({
      type: "answer",
      id: ask.id,
      value: decision,
    }),
    callResult: (call, result) => {
      seen.answered.push(call.id);
      const said = result.content.map(each => each.text).join("");
      return {
        type: "result",
        id: call.id,
        text: result.isError === true ? `error ${said}` : said,
      };
    },
  };
};

const adapter: CliAdapter = {
  driver: "omp",
  command: { bin: "fake-frames", args: () => [] },
  decode: () => ({ events: [] }),
  mcp: {
    kind: "flag",
    wire: () =>
      Promise.resolve({ args: [], env: {}, release: () => Promise.resolve() }),
  },
  permissions: { kind: "callback", denyByDefault: true },
  usage: { dollars: false, combine: (_earlier, later) => later },
  context: { instructions: [], skills: "", agents: "", env: () => ({}) },
};

const spec: SessionSpec = {
  nodeId: "worker",
  cwd: process.cwd(),
  prompt: "Work",
  systemAppend: "",
  settingSources: ["project"],
  tools: { allow: [], deny: [] },
  permissionMode: "default",
  reportSchema: { type: "object" },
};

type Started = {
  events: RuntimeEvent[];
  io: () => DuplexIo;
  seen: Seen;
  asked: Ask[];
  /** The session's queue of messages for a later send or leg. */
  pending: string[];
  finish: Promise<Leg>;
};

/** Runs the fake tool in `mode` as a leg, collecting what it yields. */
const start = (
  mode: string,
  permit: (ask: Ask) => Promise<Decision> = () => Promise.resolve("allow"),
  readyMs = 5000,
  hostTools: HostTool[] = [],
  parts: Parts = {},
): Started => {
  const events: RuntimeEvent[] = [];
  const seen: Seen = { pid: 0, answered: [] };
  const asked: Ask[] = [];
  const pending: string[] = [];
  let attached: DuplexIo | undefined;
  const leg = runDuplexLeg({
    adapter,
    bin: process.execPath,
    env: process.env,
    cwd: process.cwd(),
    args: [FAKE, mode],
    carried: undefined,
    pending,
    deferred: () => false,
    withhold: () => false,
    scope: { facts: { program: "fake-frames" } },
    codec: fakeCodec(seen, parts),
    spec,
    leg: { endpoint: { url: "", token: "" }, allowed: [], hostTools },
    permit: ask => {
      asked.push(ask);
      return permit(ask);
    },
    attach: io => {
      attached = io ?? attached;
    },
    readyMs,
    settleMs: 300,
  });
  const finish = (async () => {
    for (;;) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one event at a time
      const step = await leg.next();
      if (step.done === true) return step.value;
      events.push(step.value);
    }
  })();
  const io = (): DuplexIo => {
    if (attached === undefined) throw new Error("not attached");
    return attached;
  };
  return { events, io, seen, asked, pending, finish };
};

const hostTool = (name: string, call: HostTool["call"]): HostTool => ({
  name,
  description: name,
  parameters: { type: "object" },
  call,
});

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Long enough for a Node process to start on a loaded machine. */
const WAIT = { timeout: 5000 };

/** Waits until the leg has yielded an event of `type`. */
const yielded = async (run: Started, type: RuntimeEvent["type"]) => {
  await vi.waitFor(() => {
    expect(run.events.map(event => event.type)).toContain(type);
  }, WAIT);
};

const gone = async (pid: number) => {
  // Pid 0 would signal this process's own group, which is always alive.
  expect(pid).toBeGreaterThan(0);
  await vi.waitFor(() => {
    expect(isAlive(pid)).toBe(false);
  }, WAIT);
};

const texts = (events: RuntimeEvent[]): string[] =>
  events.flatMap(event =>
    event.type === "assistant.text" ? [event.text] : [],
  );

const finished = (events: RuntimeEvent[]) =>
  events.flatMap(event =>
    event.type === "session.finished" ? [event.outcome] : [],
  );

describe("runDuplexLeg", () => {
  it("writes the prompt after ready and ends at the settled end", async () => {
    const run = start("end");
    await expect(run.finish).resolves.toEqual({ kind: "finished" });
    expect(run.events.map(event => event.type)).toEqual([
      "session.started",
      "session.finished",
    ]);
    expect(finished(run.events)[0]?.text).toBe("done");
    await gone(run.seen.pid);
  });

  it("sends a message mid-session and matches its response by id", async () => {
    const run = start("wait");
    await yielded(run, "session.started");
    await expect(run.io().message("hello")).resolves.toBeUndefined();
    await expect(run.io().message("refuse")).rejects.toThrow("no");
    await vi.waitFor(() => {
      expect(texts(run.events)).toEqual(["hello"]);
    }, WAIT);
    run.io().stop();
    // Settled after the stop: interrupted with what it spent, as any driver.
    await expect(run.finish).resolves.toMatchObject({
      kind: "failed",
      end: "interrupted",
      spent: { sessionId: "s1", usage: { inputTokens: 7 } },
    });
    expect(finished(run.events)).toEqual([]);
    await gone(run.seen.pid);
  });

  it("kills a tool that does not settle after a stop, leaving no process", async () => {
    const run = start("deaf");
    await yielded(run, "session.started");
    run.io().stop();
    await expect(run.finish).resolves.toMatchObject({
      kind: "failed",
      end: "interrupted",
    });
    await gone(run.seen.pid);
  });

  it("rejects a request still pending when a stop ends the leg", async () => {
    const run = start("deaf");
    await yielded(run, "session.started");
    const pending = run.io().message("hi");
    run.io().stop();
    await expect(pending).rejects.toThrow("ended");
    await expect(run.finish).resolves.toMatchObject({ end: "interrupted" });
  });

  it("ends failed with the codec's diagnostic, leaving no process", async () => {
    const run = start("chunk");
    await expect(run.finish).resolves.toEqual({
      kind: "failed",
      reason:
        "fake-frames sent a frame in chunks, over its 1048576-byte frame limit",
      end: "driver_crashed",
    });
    await gone(run.seen.pid);
  });

  it("skips blank lines", async () => {
    const run = start("blank");
    await expect(run.finish).resolves.toEqual({ kind: "finished" });
    expect(finished(run.events)[0]?.text).toBe("after blanks");
  });

  it("asks permit about a tool call and writes its answer", async () => {
    const run = start("ask");
    await run.finish;
    expect(run.asked).toEqual([
      { id: "a1", tool: "bash", args: { command: "ls" } },
    ]);
    expect(texts(run.events)).toEqual(["allow"]);
  });

  it("runs overlapping host tool calls, answering each by its id with Ork's markers on failure", async () => {
    const run = start("call", undefined, 5000, [
      hostTool("ork_slow", () => delay(100).then(() => toolText("slow"))),
      hostTool("ork_fast", args =>
        Promise.resolve(toolText(JSON.stringify(args))),
      ),
      hostTool("ork_throw", () => {
        throw new Error("boom");
      }),
    ]);
    await expect(run.finish).resolves.toEqual({ kind: "finished" });
    // The slow call, made first, is answered last: no call waits for another.
    expect(texts(run.events).at(-1)).toBe("c1:slow");
    expect(texts(run.events).toSorted()).toEqual([
      "c1:slow",
      'c2:{"n":1}',
      "c3:error Invalid arguments, nothing ran:\nno Ork tool is named ork_nope",
      "c4:error Ork tool failed:\nboom",
    ]);
  });

  it("drops the answer of a host tool call still running when the leg ends", async () => {
    const called = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const run = start("call-hang", undefined, 5000, [
      hostTool("ork_hang", () => {
        called.resolve();
        return release.promise.then(() => toolText("late"));
      }),
    ]);
    await called.promise;
    run.io().stop();
    await expect(run.finish).resolves.toMatchObject({ end: "interrupted" });
    release.resolve();
    await delay(50);
    expect(run.seen.answered).toEqual([]);
  });

  it("denies when permit throws", async () => {
    const run = start("ask", () => Promise.reject(new Error("no human")));
    await run.finish;
    expect(texts(run.events)).toEqual(["deny"]);
  });

  it("rejects a pending request when the process exits", async () => {
    const run = start("exit-on-steer");
    await yielded(run, "session.started");
    await expect(run.io().message("hi")).rejects.toThrow("ended");
    await expect(run.finish).resolves.toMatchObject({
      kind: "failed",
      reason: "fake-frames exited with code 1",
    });
  });

  it("fails on a line over the frame limit", async () => {
    const run = start("huge");
    await expect(run.finish).resolves.toMatchObject({
      kind: "failed",
      reason: "fake-frames wrote a frame over the 1114112-byte line limit",
    });
    await gone(run.seen.pid);
  });

  it("fails on a line that is not JSON, with stderr's last words", async () => {
    const run = start("garbage");
    await expect(run.finish).resolves.toMatchObject({
      kind: "failed",
      reason: "fake-frames wrote a line that is not a JSON frame: boom",
    });
  });

  it("fails with the reason a crash wrote", async () => {
    const run = start("crash");
    await expect(run.finish).resolves.toMatchObject({
      kind: "failed",
      reason: "provider exploded",
    });
  });

  it("fails when the tool never says it is ready", async () => {
    // Long enough for the fake to say its pid first on a loaded machine.
    const run = start("silent", undefined, 1000);
    await expect(run.finish).resolves.toMatchObject({
      kind: "failed",
      reason: "fake-frames did not say it was ready within 1 s",
    });
    await gone(run.seen.pid);
  });

  it("ends deferred once the interrupted session settles", async () => {
    const run = start("wait");
    await yielded(run, "session.started");
    run.io().defer();
    await expect(run.finish).resolves.toMatchObject({
      kind: "deferred",
      sessionId: "s1",
      usage: { inputTokens: 7 },
    });
    expect(finished(run.events)).toEqual([]);
    await gone(run.seen.pid);
  });

  it("ends deferred after the bounded wait when the tool does not settle", async () => {
    const run = start("deaf");
    await yielded(run, "session.started");
    run.io().defer();
    await expect(run.finish).resolves.toMatchObject({
      kind: "deferred",
      sessionId: "s1",
      usage: { inputTokens: 7 },
    });
    await gone(run.seen.pid);
  });
});

describe("runDuplexLeg's messages", () => {
  beforeEach(() => {
    waited.length = 0;
  });

  it("takes a message while a tool call runs, matched by id, leaving the leg as it was", async () => {
    const gate = Promise.withResolvers<Decision>();
    const run = start("ask", () => gate.promise);
    await vi.waitFor(() => {
      expect(run.asked).toHaveLength(1);
    }, WAIT);
    await expect(run.io().message("mid-call")).resolves.toBeUndefined();
    gate.resolve("allow");
    await expect(run.finish).resolves.toEqual({ kind: "finished" });
    expect(texts(run.events)).toEqual(["mid-call", "allow"]);
  });

  it("rejects the interrupt's own request and a pending message when the leg ends", async () => {
    const run = start("deaf");
    await yielded(run, "session.started");
    const pending = run.io().message("hi");
    run.io().stop();
    await expect(pending).rejects.toThrow("ended");
    await run.finish;
    const replies = await Promise.allSettled(waited.map(({ reply }) => reply));
    // The prompt, the message, the interrupt.
    expect(waited.map(({ id }) => id)).toEqual(["r1", "r2", "r3"]);
    expect(replies.map(({ status }) => status)).toEqual([
      "fulfilled",
      "rejected",
      "rejected",
    ]);
  });

  it("keeps a message sent once deferring began for the resumed leg, never the dying turn", async () => {
    const run = start("wait");
    await yielded(run, "session.started");
    run.io().defer();
    run.io().write("late");
    await expect(run.io().message("later")).resolves.toBeUndefined();
    await expect(run.finish).resolves.toMatchObject({ kind: "deferred" });
    expect(run.pending).toEqual(["late", "later"]);
    // Only the prompt and the interrupt were written.
    expect(waited.map(({ id }) => id)).toEqual(["r1", "r2"]);
  });

  it("drops a message sent after a stop", async () => {
    const run = start("wait");
    await yielded(run, "session.started");
    run.io().stop();
    run.io().write("late");
    await expect(run.io().message("later")).rejects.toThrow("stopped");
    await run.finish;
    expect(run.pending).toEqual([]);
    expect(waited.map(({ id }) => id)).toEqual(["r1", "r2"]);
  });

  it("writes open at spawn for a codec ready at spawn", async () => {
    const run = start("silent", undefined, 5000, [], { readyAtSpawn: true });
    await yielded(run, "session.started");
    await expect(run.io().message("hi")).resolves.toBeUndefined();
    run.io().stop();
    await expect(run.finish).resolves.toMatchObject({ end: "interrupted" });
    expect(texts(run.events)).toEqual(["hi"]);
    await gone(run.seen.pid);
  });

  it("fails a codec ready at spawn whose start is never answered", async () => {
    const run = start("mute", undefined, 200, [], { readyAtSpawn: true });
    await expect(run.finish).resolves.toEqual({
      kind: "failed",
      reason: "fake-frames did not answer the session's start within 0.2 s",
      end: "driver_crashed",
    });
  });

  it("holds messages until the turn starts, for a codec that waits for one", async () => {
    const run = start("late-turn", undefined, 5000, [], {
      readyAtSpawn: true,
      waitsForTurn: true,
    });
    run.io().write("early");
    // The fake refuses a steer before its turn, so this rejects if sent early.
    await expect(run.io().message("also early")).resolves.toBeUndefined();
    await vi.waitFor(() => {
      expect(texts(run.events)).toEqual(["early", "also early"]);
    }, WAIT);
    run.io().stop();
    await expect(run.finish).resolves.toMatchObject({ end: "interrupted" });
  });
});

const none = () => Promise.resolve();

/** Waits, on no timer, until the leg has yielded the session's start. */
const begun = async (run: Started) => {
  const until = Date.now() + WAIT.timeout;
  while (
    !run.events.some(event => event.type === "session.started") &&
    Date.now() < until
  ) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- polling, not a timer
    await new Promise(resolve => {
      setImmediate(resolve);
    });
  }
};

describe("runDuplexLeg's timers", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const cases: [string, string, (run: Started) => Promise<void>][] = [
    ["ends", "end", none],
    ["fails", "chunk", none],
    [
      "is stopped",
      "wait",
      async run => {
        await begun(run);
        run.io().stop();
      },
    ],
    [
      "is stopped and killed",
      "deaf",
      async run => {
        await begun(run);
        run.io().stop();
        await vi.advanceTimersByTimeAsync(300);
      },
    ],
    [
      "is deferred",
      "wait",
      async run => {
        await begun(run);
        run.io().defer();
      },
    ],
    [
      "is never ready",
      "silent",
      async () => {
        await vi.advanceTimersByTimeAsync(200);
      },
    ],
  ];

  it.each(cases)("leaves no timer once a leg %s", async (_how, mode, act) => {
    const run = start(mode, undefined, 200);
    await act(run);
    await run.finish;
    expect(vi.getTimerCount()).toBe(0);
  });
});
