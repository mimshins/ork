/**
 * @file Tests for the session runner on a stand-in adapter whose tool speaks
 *   JSON frames both ways (`CliAdapter.protocol`, RFC-027), on a fake tool
 *   (`fixtures/fake-rpc-session.mjs`): a message sent before and after the leg
 *   is up reaches the session as a message frame, an approval ask reaches the
 *   human channel and is answered, an interrupt ends the session interrupted
 *   with no report, and a deferred call ends the leg and resumes the session on
 *   continue with the codec's resume message and the legs' usage combined, or
 *   never resumes it once stopped, or fails it when it has no session id.
 */

import path from "node:path";

import {
  createHolds,
  type RunEvent,
  type RuntimeEvent,
  type SessionSpec,
  type SessionUsage,
} from "@krapht/ork-core";
import { describe, expect, it, vi } from "vitest";

import type { CliAdapter, Codec, DecodedFrame, Frame } from "../src/adapter.ts";
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

/** What the codecs of a session were asked to write. */
type Written = { interrupts: number; opened: string[] };

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
    open: legSpec => {
      const text =
        legSpec.resume === undefined || legSpec.fork === true
          ? legSpec.prompt
          : "again";
      written.opened.push(text);
      return [request({ type: "prompt", text })];
    },
    decode: frame =>
      (decoders[String(frame["type"])] ?? (() => ({ events: [] })))(frame),
    message: text => request({ type: "steer", text }),
    interrupt: () => {
      written.interrupts += 1;
      return request({ type: "abort" });
    },
    answer: (ask, decision) => ({
      type: "answer",
      id: ask.id,
      value: decision,
    }),
  };
};

const adapterOf = (written: Written): CliAdapter => ({
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

/** Starts a session of `prompt` on the fake tool, collecting its events. */
const start = (
  prompt: string,
  options: { answer?: Permit; paused?: boolean; fork?: boolean } = {},
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
  const session = createSessionRuntime(adapterOf(written), {
    bin: process.execPath,
    holdWindowMs: 30,
  }).start(
    options.fork === true
      ? { ...specOf(prompt), resume: "source", fork: true }
      : specOf(prompt),
    { human, hold: holds.forNode("worker") },
  );
  const events: RuntimeEvent[] = [];
  const finish = (async () => {
    for await (const event of session.events) events.push(event);
  })();
  return { session, events, finish, written, holds, asked };
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

describe("the session runner, for a tool that speaks frames both ways", () => {
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
    expect(run.written.opened).toEqual(["hold", "again"]);
    expect(texts(run.events)).toEqual(["again"]);
    expect(outcomes(run.events)).toMatchObject([
      { sessionId: "s1", text: "again", usage: { inputTokens: 10, turns: 2 } },
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
