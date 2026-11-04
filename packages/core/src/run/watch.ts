/**
 * @file A `watch:` on a tool or MCP node (RFC-011): the node's look, repeated
 *   until its condition holds, with no model turn. The last look is its output.
 *   A failed look, such as a network error, is tried again up to `misses` in a
 *   row; an answer the node didn't declare fails it at once, as waiting can't
 *   mend that. The time between looks isn't work, so a pause keeps it and the
 *   run's clock stands still. It records what changed, not every look.
 */

import { timeoutMs, type Watch } from "@krapht/ork-schema";

import { evaluate, type Scope, truthy } from "../expr/evaluate.ts";
import { parseExpr } from "../expr/parse.ts";
import type { HoldPort, RuntimeEvent } from "../runtime/types.ts";
import { heldTimeout } from "./holds.ts";
import { failure } from "./results.ts";
import type { NodeOutput, NodeResult, RunEvent } from "./types.ts";

/** How many failed looks in a row end a wait, when a node doesn't say. */
export const DEFAULT_MISSES = 3;

const SAID_LIMIT = 1024;

export type WatchOutcome = "met" | "failed" | "timed_out" | "stopped";

/** What a look says, for telling whether it changed and showing it. */
const saidBy = (
  result: NodeResult,
  declared: Readonly<Record<string, unknown>> | undefined,
): string => {
  const { json, exitCode, stdout, text } = result.output;
  const value =
    declared !== undefined && typeof json === "object" && json !== null
      ? Object.fromEntries(
          Object.keys(declared).map(name => [name, Reflect.get(json, name)]),
        )
      : (json ?? { exitCode, stdout, text });
  const shown = JSON.stringify(value) ?? "";
  const said = result.ok ? shown : (result.error ?? shown);
  return said.length <= SAID_LIMIT ? said : `${said.slice(0, SAID_LIMIT)}…`;
};

/** Stands in for a look that doesn't end once it's told to. */
const leftBehind = (
  signal: AbortSignal,
  graceMs: number,
): { gone: Promise<null>; cancel: () => void } => {
  const { promise, resolve } = Promise.withResolvers<null>();
  let timer: NodeJS.Timeout | undefined;
  const start = () => {
    timer = setTimeout(() => {
      resolve(null);
    }, graceMs);
  };
  if (signal.aborted) start();
  else signal.addEventListener("abort", start, { once: true });
  return {
    gone: promise,
    cancel: () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", start);
    },
  };
};

export const runWatch = async (options: {
  id: string;
  watch: Watch;
  declared: Readonly<Record<string, unknown>> | undefined;
  /** One look; `quiet` once its call has been recorded. */
  look: (signal: AbortSignal, quiet: boolean) => Promise<NodeResult>;
  scope: () => Scope;
  hold: HoldPort | undefined;
  signal: AbortSignal;
  graceMs: number;
  onEvent: (event: RunEvent) => void;
  /** Says that the node is between looks, or isn't any more. */
  resting: (on: boolean) => void;
  /** For tests: the floor on `every` is too long for one. */
  everyMs?: number | undefined;
}): Promise<NodeResult> => {
  const { id, watch, declared, look, hold, signal, graceMs, onEvent } = options;
  const until = parseExpr(watch.until);
  if (!until.ok) return failure(`watch.until: ${until.message}`);
  const every = options.everyMs ?? timeoutMs(watch.every) ?? 0;
  const misses = watch.misses ?? DEFAULT_MISSES;
  const limit = new AbortController();
  const finished = new AbortController();
  const active = AbortSignal.any([signal, limit.signal]);
  let looks = 0;
  let missed = 0;
  let last: NodeResult | undefined;
  let lastSaid: string | undefined;

  const ended = (outcome: WatchOutcome, result: NodeResult): NodeResult => {
    onEvent({ type: "watch.ended", id, looks, outcome });
    return result;
  };

  const expiredResult = (): NodeResult => {
    const error = `watched for ${watch.timeout}, and "${watch.until}" never held`;
    return {
      ...last,
      ok: false,
      error,
      output: {
        ...last?.output,
        status: "fail",
        summary: error,
        timedOut: true,
      },
    };
  };

  /** Stands still while paused, and records the hold at once. */
  const rest = async (): Promise<void> => {
    const note = () => {
      if (hold?.held() === true) void hold.wait("start", active);
    };
    const unwatch = hold?.watch(note);
    note();
    options.resting(true);
    await heldTimeout(hold, every, active);
    options.resting(false);
    unwatch?.();
  };

  const holds = (output: NodeOutput): boolean =>
    truthy(
      evaluate(until.expr, {
        ...options.scope(),
        output: { ok: true, ...output },
      }),
    );

  const lookOnce = async (): Promise<NodeResult | null> => {
    const left = leftBehind(active, graceMs);
    try {
      return await Promise.race([look(active, looks > 0), left.gone]);
    } finally {
      left.cancel();
    }
  };

  void heldTimeout(
    hold,
    timeoutMs(watch.timeout) ?? 0,
    AbortSignal.any([signal, finished.signal]),
  ).then(elapsed => {
    if (elapsed) limit.abort();
    return elapsed;
  });

  onEvent({
    type: "watch.started",
    id,
    until: watch.until,
    every: watch.every,
    timeout: watch.timeout,
    at: new Date().toISOString(),
  });

  try {
    for (;;) {
      // One look at a time, with a wait between: that's what a watch is.
      // oxlint-disable-next-line eslint/no-await-in-loop -- see above
      await hold?.wait("start", active);
      // oxlint-disable-next-line eslint/no-await-in-loop -- see above
      const result = active.aborted ? null : await lookOnce();
      if (signal.aborted) {
        return ended("stopped", failure("stopped while watching"));
      }
      if (limit.signal.aborted || result === null) {
        return ended("timed_out", expiredResult());
      }
      looks += 1;
      last = result;
      const said = saidBy(result, declared);
      if (said !== lastSaid) {
        lastSaid = said;
        onEvent({
          type: "watch.changed",
          id,
          looks,
          ok: result.ok,
          said,
          at: new Date().toISOString(),
        });
      }
      if (result.ok) {
        missed = 0;
        if (holds(result.output)) return ended("met", result);
      } else {
        // A look that ran out of its own time may do better on the next.
        const retry =
          result.transient === true || result.output["timedOut"] === true;
        if (!retry) return ended("failed", result);
        missed += 1;
        if (missed >= misses) {
          return ended("failed", {
            ...result,
            error: `${String(missed)} looks in a row failed: ${result.error ?? "no reason given"}`,
          });
        }
      }
      // oxlint-disable-next-line eslint/no-await-in-loop -- see above
      await rest();
    }
  } finally {
    finished.abort();
  }
};

/** Whether an event only repeats a look's call, once it's been recorded. */
export const repeatsCall = (event: RuntimeEvent): boolean =>
  event.type === "tool.called" || event.type === "tool.result";
