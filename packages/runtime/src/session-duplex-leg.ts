/**
 * @file One process (leg) of a session whose tool speaks JSON frames both ways
 *   over stdin and stdout (RFC-027): the duplex counterpart of `runLeg`. It
 *   waits for the tool's `ready`, writes the codec's first requests, matches
 *   each response to its request by id, answers the tool's approval asks
 *   through the runner's `permit` and its calls of Ork's tools with
 *   `hostCalls`, and ends the session at the codec's settled end. A stop or a
 *   deferral writes the codec's interrupt and waits a bounded time for the
 *   session to settle before it closes and kills the process. It spawns as
 *   `runLeg` does (`leg-spawn.ts`, the orphan guard), and settles events and
 *   ends with the same `legStep`.
 */

import {
  lowerChild,
  type RuntimeEvent,
  type SessionUsage,
} from "@krapht/ork-core";

import {
  type Ask,
  type Decision,
  type Frame,
  type FrameRequest,
  MAX_FRAME_LINE_BYTES,
} from "./adapter.ts";
import {
  decodeSafely,
  inbox,
  type Item,
  parsed,
  requestTable,
  watched,
} from "./frame-lines.ts";
import { hostCalls } from "./host-calls.ts";
import { spawnLeg } from "./leg-spawn.ts";
import { type Leg, legStep, tokenCapEnd, withCarried } from "./leg-step.ts";
import { classifyProviderError } from "./provider-errors.ts";
import {
  driverFailure,
  failureKind,
  failureReason,
  NOTHING_SPENT,
} from "./session-end.ts";
import type { DuplexLegInput } from "./session-leg.ts";

/** How long the tool may take to say it is ready (the spike saw 25 s once). */
export const READY_MS = 45_000;

/** How long a stopped, deferred or ended session may take to settle and exit. */
export const SETTLE_MS = 10_000;

const ignore = () => null;

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Runs one duplex process of a session, yielding its events; returns how it
 * ended.
 */
export const runDuplexLeg = async function* (
  input: DuplexLegInput,
): AsyncGenerator<RuntimeEvent, Leg> {
  const { codec } = input;
  const name = input.adapter.command.bin;
  const readyMs = input.readyMs ?? READY_MS;
  const settleMs = input.settleMs ?? SETTLE_MS;
  const child = spawnLeg(input);
  lowerChild(input.priority, child.pid);
  const box = inbox<Item>();
  const { later } = box;
  const stderr = watched(child, box);
  /** Aborted at the leg's end: a pending `permit` is withdrawn. */
  const done = new AbortController();
  const requests = requestTable(() => new Error(`${name}'s session has ended`));
  const opened = Promise.withResolvers<void>();
  // A message waiting for `ready` must not reject unseen if the leg ends first.
  opened.promise.catch(ignore);

  const write = (frame: Frame) => {
    if (child.stdin.writable) child.stdin.write(`${JSON.stringify(frame)}\n`);
  };
  const send = (request: FrameRequest): Promise<void> => {
    const reply = requests.wait(request.id);
    write(request.frame);
    return reply;
  };
  const message = async (text: string): Promise<void> => {
    await opened.promise;
    await send(codec.message(text));
  };
  let isOpen = false;
  let stopped = false;
  let deferring = false;
  /** Writes the interrupt, and gives the session a bounded time to settle. */
  const interrupt = () => {
    if (isOpen) send(codec.interrupt()).catch(ignore);
    // Before `ready` there is no turn to stop: the process just ends.
    else child.stdin.end();
    later(settleMs, { kind: "settle-late" });
  };
  input.attach({
    write: text => {
      message(text).catch(ignore);
    },
    stop: () => {
      if (stopped) return;
      stopped = true;
      interrupt();
    },
    message,
    defer: () => {
      if (stopped || deferring) return;
      deferring = true;
      interrupt();
    },
  });
  later(readyMs, { kind: "ready-late" });

  /** A failure of the tool's, explained with its stderr's last words. */
  const failed = (why: string): Leg => {
    const reason =
      stderr().trim() === ""
        ? why
        : `${why}: ${failureReason(name, stderr(), null)}`;
    return {
      kind: "failed",
      reason,
      end: classifyProviderError(reason)?.kind ?? "driver_crashed",
    };
  };
  const decide = async (ask: Ask) => {
    const decision = await input
      .permit(ask, done.signal)
      .catch((): Decision => "deny");
    write(codec.answer(ask, decision));
  };
  const serve = hostCalls(input.leg.hostTools, codec, write, done.signal);
  /** The tool is ready: the first requests, then the messages that waited. */
  const open = () => {
    isOpen = true;
    for (const request of codec.open(input.spec, input.leg)) {
      send(request).catch((error: unknown) => {
        box.push({
          kind: "fail",
          reason: `${name} refused the session's start: ${messageOf(error)}`,
        });
      });
    }
    opened.resolve();
    for (const text of input.pending.splice(0)) message(text).catch(ignore);
  };

  let outcome: Leg | undefined;
  let sessionId = "";
  /** What this leg has used so far, as the last usage step said. */
  let used: SessionUsage | undefined;
  const stepInput = { ...input, deferred: () => deferring };

  /** One line's events, and the leg's end when the line ends it. */
  const onLine = (text: string): { events: RuntimeEvent[]; leg?: Leg } => {
    const frame = parsed(text);
    if (frame === undefined) {
      return {
        events: [],
        leg: failed(`${name} wrote a line that is not a JSON frame`),
      };
    }
    const decoded = decodeSafely(codec, frame);
    if (decoded.fail !== undefined)
      return { events: [], leg: failed(decoded.fail) };
    if (decoded.reply !== undefined) requests.answered(decoded.reply);
    for (const back of decoded.write ?? []) write(back);
    if (decoded.ask !== undefined) void decide(decoded.ask);
    if (decoded.call !== undefined) serve(decoded.call);
    if (decoded.ready === true && !isOpen && !stopped && !deferring) open();
    used = decoded.usage ?? used;
    for (const event of decoded.events) {
      if (event.type === "session.started") sessionId = event.sessionId;
    }
    const { events, ended } = legStep(
      { ...decoded, deferred: deferring },
      stepInput,
      stopped,
    );
    if (ended !== undefined) {
      // The session has ended: the process closes, given a bounded time. One
      // Ork stopped ends interrupted, as a stopped process of any driver does.
      outcome = stopped ? interrupted() : ended;
      child.stdin.end();
      later(settleMs, { kind: "settle-late" });
      return {
        events: stopped
          ? events.filter(event => event.type !== "session.finished")
          : events,
      };
    }
    const capped = tokenCapEnd(input, decoded.usage, sessionId);
    return capped === undefined
      ? { events }
      : { events: [...events, capped], leg: { kind: "finished" } };
  };

  /** An interrupted leg, with what the session had spent and its id. */
  const interrupted = (): Leg => {
    const usage = withCarried(input, used);
    const spent = usage === undefined ? {} : { spent: { usage, sessionId } };
    return {
      kind: "failed",
      reason: "interrupted",
      end: "interrupted",
      ...spent,
    };
  };

  /** The deferred leg, when its session never says it settled. */
  const deferredLeg = (): Leg => {
    const spent = withCarried(input, used) ?? NOTHING_SPENT.usage;
    const last = driverFailure("interrupted", "interrupted", input.scope, {
      usage: spent,
      sessionId,
    });
    return {
      kind: "deferred",
      sessionId,
      usage: used ?? NOTHING_SPENT.usage,
      last,
    };
  };

  /** How the process's exit ends the leg. */
  const onExit = (code: number | null, signal: NodeJS.Signals | null): Leg => {
    if (outcome !== undefined) return outcome;
    if (deferring && !stopped) return deferredLeg();
    if (stopped || signal !== null) return interrupted();
    const reason = failureReason(name, stderr(), code);
    return {
      kind: "failed",
      reason,
      end: classifyProviderError(reason)?.kind ?? "driver_crashed",
    };
  };

  /** How anything but a line ends the leg, if it does. */
  const onItem = (item: Exclude<Item, { kind: "line" }>): Leg | undefined => {
    if (item.kind === "exit") return onExit(item.code, item.signal);
    if (item.kind === "error") {
      const reason = `could not start ${input.bin}: ${item.error.message}`;
      return { kind: "failed", reason, end: failureKind(item.error) };
    }
    if (item.kind === "over") {
      return failed(
        `${name} wrote a frame over the ${String(MAX_FRAME_LINE_BYTES)}-byte line limit`,
      );
    }
    if (item.kind === "fail") {
      return outcome === undefined ? failed(item.reason) : undefined;
    }
    if (item.kind === "ready-late") {
      return isOpen || stopped || deferring
        ? undefined
        : failed(
            `${name} did not say it was ready within ${String(readyMs / 1000)} s`,
          );
    }
    if (outcome !== undefined) return outcome;
    if (deferring && !stopped) return deferredLeg();
    // A stop the tool did not settle in time: its exit ends it, interrupted.
    child.stdin.end();
    child.kill("SIGKILL");
    return undefined;
  };

  try {
    for (;;) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one item at a time
      const item = await box.next();
      if (item.kind !== "line") {
        const leg = onItem(item);
        if (leg !== undefined) return leg;
        continue;
      }
      // Nothing a tool writes after its session ended is the session's; a
      // blank line is no frame.
      if (outcome !== undefined || item.text.trim() === "") continue;
      const { events, leg } = onLine(item.text);
      yield* events;
      if (leg !== undefined) return leg;
    }
  } finally {
    input.attach();
    done.abort();
    box.clear();
    requests.close();
    opened.reject(new Error(`${name}'s session has ended`));
    child.stdin.end();
    if (child.exitCode === null) child.kill();
  }
};
