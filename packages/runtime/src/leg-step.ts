/**
 * @file Settling what one leg of a session says, for either kind of leg (the
 *   one-way pipe of `session-leg.ts` and the duplex one of
 *   `session-duplex-leg.ts`): each decoded line's events, the session's end
 *   with its report and what the legs before it spent, the token cap, and how
 *   the leg ended.
 */

import {
  type EndKind,
  endFor,
  type NodeReport,
  type RuntimeEvent,
  type SessionOutcome,
  type SessionUsage,
} from "@krapht/ork-core";
import type { Driver } from "@krapht/ork-schema";

import type { CliAdapter, Decoded } from "./adapter.ts";
import {
  type EndScope,
  settleEnd,
  type Spent,
  tokenCapOutcome,
} from "./session-end.ts";

/** How much of the end of a process's stderr is kept to explain its death. */
export const STDERR_TAIL = 16_384;

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

/** What settling a leg's events and its end reads of the leg. */
export type StepInput = {
  adapter: CliAdapter;
  /** What the legs before this one spent; none for the first. */
  carried: SessionUsage | undefined;
  /** Whether the hold hook deferred a call in this process. */
  deferred: () => boolean;
  /** Whether a message waits for the next leg, so the result is not the end. */
  withhold: () => boolean;
  /**
   * The report handed in through Ork's `report` tool, when the session has it:
   * the session's report then, whatever the tool's result line says.
   */
  reported?: () => NodeReport | null;
  /** What the session's end is written with. */
  scope: EndScope;
};

/**
 * A session's outcome with its report (the one Ork's `report` tool accepted,
 * when the session has that tool) and its end settled. A session Ork `stopped`
 * with no report ends `interrupted`, whatever result line its tool printed.
 */
const settled = (
  outcome: SessionOutcome,
  input: StepInput,
  stopped = false,
): SessionOutcome => {
  const report =
    input.reported === undefined ? outcome.report : input.reported();
  const end = stopped && report === null ? endFor("interrupted") : outcome.end;
  return settleEnd(
    { ...outcome, report, ...(end === undefined ? {} : { end }) },
    input.scope.facts,
    input.scope.scrub,
  );
};

/** A deferred leg's result once Ork stopped the session: as `settled`, stopped. */
export const asStopped = (last: RuntimeEvent, input: StepInput): RuntimeEvent =>
  last.type === "session.finished"
    ? { ...last, outcome: settled(last.outcome, input, true) }
    : last;

/** What this leg `used`, with what the legs before it spent. */
export const withCarried = (
  input: StepInput,
  used: SessionUsage | undefined,
): SessionUsage | undefined =>
  used === undefined || input.carried === undefined
    ? (used ?? input.carried)
    : input.adapter.usage.combine(input.carried, used);

/** The session's end at its token cap, its earlier legs' usage included. */
export const tokenCapEnd = (
  input: StepInput,
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
 * spent. `stopped` is whether Ork had stopped the leg when the line came.
 */
export const legStep = (
  decoded: Decoded,
  input: StepInput,
  stopped = false,
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
      outcome: settled({ ...said.outcome, usage }, input, stopped),
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
