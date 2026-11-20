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
  lowerChild,
  type RuntimeEvent,
  type SessionSpec,
  type SessionUsage,
} from "@krapht/ork-core";
import type { Priority } from "@krapht/ork-schema";

import type {
  Ask,
  Codec,
  Decision,
  LegContext,
  LegDecoder,
} from "./adapter.ts";
import { spawnLeg } from "./leg-spawn.ts";
import {
  type Leg,
  legStep,
  STDERR_TAIL,
  type StepInput,
  tokenCapEnd,
  withCarried,
} from "./leg-step.ts";
import { classifyProviderError } from "./provider-errors.ts";
import { failureKind, failureReason, heldUsage } from "./session-end.ts";

export type LegInput = StepInput & {
  bin: string;
  env: Readonly<Record<string, string | undefined>>;
  /** `low`: the process starts below Ork's priority (`machine/priority.ts`). */
  priority?: Priority;
  cwd: string;
  args: string[];
  /** Lines to write once the process is up; emptied as they are written. */
  pending: string[];
  /** The process's stdin and stop while it runs; nothing after. */
  attach: (io?: { write: (line: string) => void; stop: () => void }) => void;
  /** The adapter's decoder for this leg, when it has one (`legDecoder`). */
  decoder?: LegDecoder;
};

/** What the runner holds of a running duplex leg; nothing after it ends. */
export type DuplexIo = {
  /** `message`, its failure dropped: what the runner's `send` calls. */
  write: (text: string) => void;
  /** Stops the turn; the session ends `interrupted` with no report. */
  stop: () => void;
  /** Sends a message to the running session; settles with the tool's response. */
  message: (text: string) => Promise<void>;
  /** Ends the leg `deferred`, to resume the session later. */
  defer: () => void;
};

/** A duplex leg's input (`session-duplex-leg.ts`): a leg's, with its codec. */
export type DuplexLegInput = Omit<
  LegInput,
  "attach" | "decoder" | "pending"
> & {
  /** This leg's codec (`CliAdapter.protocol(spec)`). */
  codec: Codec;
  /** What the codec's first requests are made of. */
  spec: SessionSpec;
  leg: LegContext;
  /** Messages to send once the first requests are written; emptied then. */
  pending: string[];
  /**
   * Asks a human or the node's rules about a tool call; aborted at the leg's
   * end.
   */
  permit: (ask: Ask, signal: AbortSignal) => Promise<Decision>;
  attach: (io?: DuplexIo) => void;
  /** Override `READY_MS` and `SETTLE_MS` (tests shorten them). */
  readyMs?: number;
  settleMs?: number;
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
  const stop = () => {
    stopped = true;
    child.kill("SIGINT");
  };
  input.attach({ write, stop });
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
      const { events, ended } = legStep(decoded, input, stopped);
      for (const event of decoded.events) {
        if (event.type === "session.started") sessionId = event.sessionId;
      }
      yield* events;
      if (ended !== undefined) {
        // The first result ends the process; a resume continues the session.
        child.stdin.end();
        outcome = ended;
        // Ended while the tool runs on: nothing it prints after is the session's.
        if (decoded.kill === true) {
          stop();
          return ended;
        }
      }
      const capped =
        outcome === undefined
          ? tokenCapEnd(input, decoded.usage, sessionId)
          : undefined;
      if (capped !== undefined) {
        stop();
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
      const reason = `could not start ${input.bin}: ${end.message}`;
      return { kind: "failed", reason, end: failureKind(end) };
    }
    if (stopped || end.signal !== null) {
      const held = stopped && heldUsage(decoder?.exit(end.code));
      const usage = withCarried(input, held || used);
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
