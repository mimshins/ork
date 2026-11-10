/**
 * @file One process (leg) of a session the runner drives: it writes the queued
 *   stdin lines, yields the adapter's decoded events, and says how it ended. A
 *   session is one leg, or several when a paused node's tool call was deferred
 *   or a message waits for a tool that takes none mid-session; a resumed leg
 *   carries what the legs before it spent, and its start is not news.
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

import {
  maskSecrets,
  type NodeReport,
  type RuntimeEvent,
  type SessionUsage,
} from "@krapht/ork-core";
import type { Driver } from "@krapht/ork-schema";

import type { CliAdapter, Decoded, LegDecoder } from "./adapter.ts";

/** How much of the end of a process's stderr is kept to explain its death. */
const STDERR_TAIL = 16_384;
const REASON_LIMIT = 500;

/** Marks a session's start with the driver that runs it. */
export const withDriver = (event: RuntimeEvent, driver: Driver): RuntimeEvent =>
  event.type === "session.started" ? { ...event, driver } : event;

/** A finished event for a session the driver could not run. */
export const driverFailure = (message: string): RuntimeEvent => ({
  type: "session.finished",
  outcome: {
    subtype: "error_driver",
    sessionId: "",
    report: null,
    text: "",
    usage: {
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      turns: 0,
      durationMs: 0,
    },
    errors: [message],
  },
});

/** How one leg of a session (one process) ended. */
export type Leg =
  | { kind: "finished" }
  | {
      /**
       * `deferred`: the hold hook deferred a call; `continued`: a message
       * waits.
       */
      kind: "deferred" | "continued";
      sessionId: string;
      usage: SessionUsage;
      /** Its result, yielded only if the session never resumes. */
      last: RuntimeEvent;
    }
  | { kind: "failed"; reason: string };

export type LegInput = {
  adapter: CliAdapter;
  bin: string;
  env: Readonly<Record<string, string | undefined>>;
  cwd: string;
  args: string[];
  /** What the legs before this one spent; none for the first. */
  carried: SessionUsage | undefined;
  /** Lines to write once the process is up; emptied as they are written. */
  pending: string[];
  /** Whether the hold hook deferred a call in this process. */
  deferred: () => boolean;
  /** Whether a message waits for the next leg, so the result is not the end. */
  withhold: () => boolean;
  /**
   * The report handed in through Ork's `report` tool, when the session has it:
   * the session's report then, whatever the tool's result line says.
   */
  reported?: () => NodeReport | null;
  /** The process's stdin and stop while it runs; nothing after. */
  attach: (io?: { write: (line: string) => void; stop: () => void }) => void;
  /** The adapter's decoder for this leg, when it has one (`legDecoder`). */
  decoder?: LegDecoder;
};

/**
 * What one decoded line yields, and how the leg ends if it does: a result is
 * the session's end, unless the hold hook deferred a call or a message waits; a
 * resumed leg's start is not news, and its end carries what the legs before it
 * spent.
 */
const legStep = (
  decoded: Decoded,
  input: LegInput,
): { events: RuntimeEvent[]; ended?: Leg } => {
  const { adapter, carried } = input;
  const deferred = input.deferred() && decoded.deferred === true;
  const events: RuntimeEvent[] = [];
  let ended: Leg | undefined;
  for (const said of decoded.events) {
    const event =
      said.type === "session.finished" && input.reported !== undefined
        ? { ...said, outcome: { ...said.outcome, report: input.reported() } }
        : said;
    if (event.type === "session.started" && carried !== undefined) continue;
    if (event.type !== "session.finished") {
      events.push(withDriver(event, adapter.driver));
    } else if (deferred) {
      ended = {
        kind: "deferred",
        sessionId: event.outcome.sessionId,
        usage: event.outcome.usage,
        last: event,
      };
    } else {
      const usage =
        carried === undefined
          ? event.outcome.usage
          : adapter.usage.combine(carried, event.outcome.usage);
      const last = { ...event, outcome: { ...event.outcome, usage } };
      // A queued message continues only a session that ended well; an error
      // (a turn limit, a failed run) ends it, so no limit is overrun or hidden.
      if (input.withhold() && event.outcome.subtype === "success") {
        ended = {
          kind: "continued",
          sessionId: event.outcome.sessionId,
          usage: event.outcome.usage,
          last,
        };
      } else {
        events.push(last);
        ended = { kind: "finished" };
      }
    }
  }
  return ended === undefined ? { events } : { events, ended };
};

/** Noise a Node crash ends stderr with, or a stack frame: never the reason. */
const isNoise = (line: string): boolean =>
  /^Node\.js v\d/u.test(line) || /^\s+at /u.test(line);

/**
 * Why a process ended without a result: the last block of its stderr as one
 * masked, capped line (the reason reaches the terminal, which is not masked).
 */
const failureReason = (
  name: string,
  stderr: string,
  code: number | null,
): string => {
  const block = stderr
    .split("\n")
    .filter(line => !isNoise(line))
    .join("\n")
    .split(/\n\s*\n/u)
    .map(text => text.trim().replaceAll(/\s*\n\s*/gu, " "))
    .findLast(text => text !== "");
  return block === undefined
    ? `${name} exited with code ${String(code)}`
    : maskSecrets(block).slice(0, REASON_LIMIT);
};

/** Runs one process of a session, yielding its events; returns how it ended. */
export const runLeg = async function* (
  input: LegInput,
): AsyncGenerator<RuntimeEvent, Leg> {
  const child = spawn(input.bin, input.args, {
    cwd: input.cwd,
    env: { ...input.env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const exited = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>(resolve => {
    child.on("close", (code, signal) => {
      resolve({ code, signal });
    });
  });
  const spawnError = new Promise<Error>(resolve => {
    child.on("error", resolve);
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(-STDERR_TAIL);
  });
  const write = (line: string) => {
    if (child.stdin.writable) child.stdin.write(line);
  };
  let stopped = false;
  input.attach({
    write,
    stop: () => {
      stopped = true;
      child.kill("SIGINT");
    },
  });
  for (const line of input.pending.splice(0)) write(line);
  if (input.adapter.command.input === undefined) child.stdin.end();

  let outcome: Leg | undefined;
  const { decoder } = input;
  const decode =
    decoder?.decode ?? input.adapter.decoder?.() ?? input.adapter.decode;
  try {
    for await (const line of createInterface({ input: child.stdout })) {
      const { events, ended } = legStep(decode(line), input);
      yield* events;
      if (ended !== undefined) {
        // The first result ends the process; a resume continues the session.
        child.stdin.end();
        outcome = ended;
      }
    }
    const end = await Promise.race([exited, spawnError.then(error => error)]);
    if (outcome !== undefined) return outcome;
    // A tool with no result line ends its session by exiting.
    if (
      decoder !== undefined &&
      !(end instanceof Error) &&
      !stopped &&
      end.signal === null
    ) {
      const { events, ended } = legStep(
        { events: decoder.exit(end.code) },
        input,
      );
      yield* events;
      if (ended !== undefined) return ended;
    }
    if (end instanceof Error) {
      return {
        kind: "failed",
        reason: `could not start ${input.bin}: ${end.message}`,
      };
    }
    return {
      kind: "failed",
      reason:
        stopped || end.signal !== null
          ? "interrupted"
          : failureReason(input.adapter.command.bin, stderr, end.code),
    };
  } finally {
    input.attach();
    if (child.exitCode === null) child.kill();
  }
};
