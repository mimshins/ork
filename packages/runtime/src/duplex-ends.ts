/**
 * @file How a duplex leg (`session-duplex-leg.ts`, RFC-027) ends when its
 *   session does not say so itself: failed with a reason, interrupted with what
 *   it spent, or deferred to be resumed by its session id.
 */

import type { SessionUsage } from "@krapht/ork-core";

import { type Leg, type StepInput, withCarried } from "./leg-step.ts";
import { classifyProviderError } from "./provider-errors.ts";
import { driverFailure, NOTHING_SPENT } from "./session-end.ts";

/** A failed leg, its end read from the reason. */
export const failedLeg = (reason: string): Leg => ({
  kind: "failed",
  reason,
  end: classifyProviderError(reason)?.kind ?? "driver_crashed",
});

/** An interrupted leg, with what the session had spent and its id. */
export const interruptedLeg = (
  input: StepInput,
  used: SessionUsage | undefined,
  sessionId: string,
): Leg => {
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
export const deferredLeg = (
  input: StepInput,
  used: SessionUsage | undefined,
  sessionId: string,
): Leg => {
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
