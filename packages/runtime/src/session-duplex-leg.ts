/**
 * @file One process (leg) of a session whose tool speaks JSON frames both ways
 *   over stdin and stdout (RFC-027): the duplex counterpart of `runLeg`. It
 *   waits for the tool's `ready` (or, for a codec `readyAtSpawn`, not), writes
 *   the codec's first requests, holds messages until the session takes them
 *   (until a turn starts, for a codec that `waitsForTurn`; past a deferral, for
 *   the resumed leg), matches responses to requests by id, answers approval
 *   asks with the runner's `permit` and host tool calls with `hostCalls`, and
 *   ends at the codec's settled end. A stop or deferral writes the interrupt
 *   and waits a bounded time to settle before it kills the process. It spawns
 *   and settles events as `runLeg` does (`leg-spawn.ts`, `legStep`).
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
import { deferredLeg, failedLeg, interruptedLeg } from "./duplex-ends.ts";
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
import { type Leg, legStep, tokenCapEnd } from "./leg-step.ts";
import { failureKind, failureReason } from "./session-end.ts";
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
  /** Messages wait for it: `open` written (or a turn, if it `waitsForTurn`). */
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
  let isOpen = false;
  /** `opened` has resolved: a message is sent, not held. */
  let steerable = false;
  /** Every response to `open`'s requests has come. */
  let started = false;
  let stopped = false;
  let deferring = false;
  const message = async (text: string): Promise<void> => {
    // Sent at once when it can be, so a stop right after comes after it.
    if (!steerable) await opened.promise;
    if (stopped) throw new Error(`${name}'s session was stopped`);
    // The deferred turn is ending: the resumed leg sends it instead.
    if (deferring) {
      input.pending.push(text);
      return;
    }
    await send(codec.message(text));
  };
  /** The session takes messages now: the ones that waited go first. */
  const steer = () => {
    steerable = true;
    opened.resolve();
    for (const text of input.pending.splice(0)) message(text).catch(ignore);
  };
  /** Writes the interrupt, and gives the session a bounded time to settle. */
  const interrupt = () => {
    // A leg that has returned has nothing to stop, and no timer to start.
    if (done.signal.aborted) return;
    if (steerable) send(codec.interrupt()).catch(ignore);
    // Before `ready` (or the turn) there is no turn to stop: the process ends.
    else child.stdin.end();
    later(settleMs, { kind: "settle-late" });
  };
  input.attach({
    // Held in the shared queue until the session takes messages, and while a
    // deferral ends the turn (the resumed leg's `open` sends it); a stopped
    // session drops it.
    write: text => {
      if (stopped) return;
      if (steerable && !deferring) message(text).catch(ignore);
      else input.pending.push(text);
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

  /** A failure of the tool's, explained with its stderr's last words. */
  const failed = (why: string): Leg =>
    failedLeg(
      stderr().trim() === ""
        ? why
        : `${why}: ${failureReason(name, stderr(), null)}`,
    );
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
    const replies = codec.open(input.spec, input.leg).map(request =>
      send(request).catch((error: unknown) => {
        box.push({
          kind: "fail",
          reason: `${name} refused the session's start: ${messageOf(error)}`,
        });
      }),
    );
    // A codec that waits for the turn is started by it: bounds the whole handshake.
    void Promise.all(replies).then(() => {
      if (codec.waitsForTurn !== true) started = true;
      return null;
    });
    if (codec.waitsForTurn !== true) steer();
  };
  if (codec.readyAtSpawn === true) open();
  later(readyMs, { kind: "ready-late" });

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
    const turned = decoded.turn === true && codec.waitsForTurn === true;
    if (turned) started = true;
    if (turned && isOpen && !steerable && !stopped && !deferring) steer();
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

  const interrupted = () => interruptedLeg(input, used, sessionId);
  const deferred = () => deferredLeg(input, used, sessionId);

  /** How the process's exit ends the leg. */
  const onExit = (code: number | null, signal: NodeJS.Signals | null): Leg => {
    if (outcome !== undefined) return outcome;
    if (deferring && !stopped) return deferred();
    if (stopped || signal !== null) return interrupted();
    return failedLeg(failureReason(name, stderr(), code));
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
      const within = `within ${String(readyMs / 1000)} s`;
      if (stopped || deferring) return undefined;
      if (codec.readyAtSpawn === true) {
        return started
          ? undefined
          : failed(`${name} did not answer the session's start ${within}`);
      }
      return isOpen
        ? undefined
        : failed(`${name} did not say it was ready ${within}`);
    }
    if (outcome !== undefined) return outcome;
    if (deferring && !stopped) return deferred();
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
