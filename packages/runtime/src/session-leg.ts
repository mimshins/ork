/**
 * @file One process (leg) of a session the runner drives: it writes the queued
 *   stdin lines, yields the adapter's decoded events, and says how it ended. A
 *   session is one leg, or several when a paused node's tool call was deferred
 *   or a message waits for a tool that takes none mid-session; a resumed leg
 *   carries what the legs before it spent, and its start is not news. Off
 *   Windows the process ends with `ork`, whatever ends `ork` (the orphan
 *   guard).
 */

import { createInterface } from "node:readline";

import {
  type EndKind,
  lowerChild,
  type NodeReport,
  type RuntimeEvent,
  type SessionOutcome,
  type SessionUsage,
} from "@krapht/ork-core";
import type { Driver, Priority } from "@krapht/ork-schema";

import type { CliAdapter, Decoded, LegDecoder } from "./adapter.ts";
import { spawnLeg } from "./leg-spawn.ts";
import { classifyProviderError } from "./provider-errors.ts";
import {
  type EndScope,
  failureKind,
  failureReason,
  settleEnd,
  type Spent,
  tokenCapOutcome,
} from "./session-end.ts";

/** How much of the end of a process's stderr is kept to explain its death. */
const STDERR_TAIL = 16_384;

/** Marks a session's start with the driver that runs it. */
export const withDriver = (event: RuntimeEvent, driver: Driver): RuntimeEvent =>
  event.type === "session.started" ? { ...event, driver } : event;

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
  | {
      kind: "failed";
      reason: string;
      end: EndKind;
      /** What the session had spent when it stopped, earlier legs included. */
      spent?: Spent;
    };

export type LegInput = {
  adapter: CliAdapter;
  bin: string;
  env: Readonly<Record<string, string | undefined>>;
  /** `low`: the process starts below Ork's priority (`machine/priority.ts`). */
  priority?: Priority;
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
  /** What the session's end is written with. */
  scope: EndScope;
};

/**
 * A session's outcome with its report (the one Ork's `report` tool accepted,
 * when the session has that tool) and its end settled.
 */
const settled = (outcome: SessionOutcome, input: LegInput): SessionOutcome =>
  settleEnd(
    input.reported === undefined
      ? outcome
      : { ...outcome, report: input.reported() },
    input.scope.facts,
    input.scope.scrub,
  );

/** What this leg `used`, with what the legs before it spent. */
const withCarried = (
  input: LegInput,
  used: SessionUsage | undefined,
): SessionUsage | undefined =>
  used === undefined || input.carried === undefined
    ? (used ?? input.carried)
    : input.adapter.usage.combine(input.carried, used);

/** The session's end at its token cap, its earlier legs' usage included. */
const tokenCapEnd = (
  input: LegInput,
  used: SessionUsage | undefined,
  sessionId: string,
): RuntimeEvent | undefined => {
  const capped = tokenCapOutcome(
    input.scope.facts,
    used === undefined ? undefined : withCarried(input, used),
    sessionId,
  );
  return capped === undefined
    ? undefined
    : { type: "session.finished", outcome: settled(capped, input) };
};

/** The kinds of a session that ended well, so a queued message continues it. */
const wentWell = (kind: EndKind | undefined): boolean =>
  kind === "done" || kind === "reported_failure" || kind === "no_report";

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
    if (said.type === "session.started" && carried !== undefined) continue;
    if (said.type !== "session.finished") {
      events.push(withDriver(said, adapter.driver));
      continue;
    }
    // The end is written with the whole session's spend; the leg's own goes
    // back to the runner to add up.
    const own = said.outcome.usage;
    const usage =
      carried === undefined ? own : adapter.usage.combine(carried, own);
    const last = {
      ...said,
      outcome: settled({ ...said.outcome, usage }, input),
    };
    const { sessionId, end } = last.outcome;
    // A queued message continues only a session that ended well; an error
    // (a turn limit, a failed run) ends it, so no limit is overrun or hidden.
    if (deferred) {
      ended = { kind: "deferred", sessionId, usage: own, last };
    } else if (input.withhold() && wentWell(end?.kind)) {
      ended = { kind: "continued", sessionId, usage: own, last };
    } else {
      events.push(last);
      ended = { kind: "finished" };
    }
  }
  return ended === undefined ? { events } : { events, ended };
};

/** Runs one process of a session, yielding its events; returns how it ended. */
export const runLeg = async function* (
  input: LegInput,
): AsyncGenerator<RuntimeEvent, Leg> {
  const child = spawnLeg(input);
  lowerChild(input.priority, child.pid);
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
  let sessionId = "";
  /** What this leg has used so far, as the last usage step said. */
  let used: SessionUsage | undefined;
  const { decoder } = input;
  const decode = decoder?.decode ?? input.adapter.decode;
  try {
    for await (const line of createInterface({ input: child.stdout })) {
      const decoded = decode(line);
      used = decoded.usage ?? used;
      const { events, ended } = legStep(decoded, input);
      for (const event of decoded.events) {
        if (event.type === "session.started") sessionId = event.sessionId;
      }
      yield* events;
      if (ended !== undefined) {
        // The first result ends the process; a resume continues the session.
        child.stdin.end();
        outcome = ended;
      }
      const capped =
        outcome === undefined
          ? tokenCapEnd(input, decoded.usage, sessionId)
          : undefined;
      if (capped !== undefined) {
        // Nothing the tool prints after it is the session's.
        stopped = true;
        child.kill("SIGINT");
        yield capped;
        return { kind: "finished" };
      }
    }
    const end = await Promise.race([exited, spawnError.then(error => error)]);
    if (outcome !== undefined) return outcome;
    // A tool with no result line ends its session by exiting; one killed by a
    // signal Ork did not send may still have printed (and its decoder held) one.
    if (decoder !== undefined && !(end instanceof Error) && !stopped) {
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
        end: failureKind(end),
      };
    }
    if (stopped || end.signal !== null) {
      const usage = withCarried(input, used);
      return {
        kind: "failed",
        reason: "interrupted",
        end: "interrupted",
        ...(usage === undefined ? {} : { spent: { usage, sessionId } }),
      };
    }
    const reason = failureReason(input.adapter.command.bin, stderr, end.code);
    return {
      kind: "failed",
      reason,
      end: classifyProviderError(reason)?.kind ?? "driver_crashed",
    };
  } finally {
    input.attach();
    if (child.exitCode === null) child.kill();
  }
};
